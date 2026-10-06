using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Media;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Speech.AudioFormat;
using System.Speech.Recognition;
using System.Speech.Synthesis;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

namespace LuciferNative {
  static class Program {
    [STAThread]static void Main(string[] args){
      string root=Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"..",".."));Directory.SetCurrentDirectory(root);
      bool tray=args.Contains("--tray"),settings=args.Contains("--settings");string role=tray?"tray":"supervisor";
      try{
        NativeDesktop.Identify();NativeLog.Write(root,role,"process.start",new {settingsRequested=settings});
        bool owner;using(var mutex=new Mutex(true,"Local\\LUCIFER."+role+"."+Environment.UserName,out owner)){
          if(!owner){bool reused=NativeDesktop.Control(settings?"settings":"refresh-icon");NativeLog.Write(root,role,"duplicate.reused",new {controlAccepted=reused});return;}
          if(!tray){
            while(true){var child=Process.Start(new ProcessStartInfo(Application.ExecutablePath,"--tray"+(settings?" --settings":"")){UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=root});settings=false;NativeLog.Write(root,role,"tray.started",new {childId=child.Id});child.WaitForExit();int exitCode=child.ExitCode;NativeLog.Write(root,role,"tray.exited",new {childId=child.Id,exitCode=exitCode});if(exitCode==10)break;NativeLog.Write(root,role,"tray.restarting",new {previousExitCode=exitCode});Thread.Sleep(1500);}
            NativeLog.Write(root,role,"process.exit");return;
          }
          Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
          Application.ThreadException+=delegate(object sender,System.Threading.ThreadExceptionEventArgs e){NativeLog.Failure(root,role,"ui.exception",e.Exception);Environment.Exit(1);};
          AppDomain.CurrentDomain.UnhandledException+=delegate(object sender,UnhandledExceptionEventArgs e){var error=e.ExceptionObject as Exception;if(error!=null)NativeLog.Failure(root,role,"runtime.exception",error);Environment.Exit(1);};
          Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);Application.Run(new Tray(root,settings));
        }
      }catch(Exception error){NativeLog.Failure(root,role,"startup.failed",error);Environment.Exit(1);}
    }
  }
  sealed class Tray : Form {
    readonly string root,dir;readonly JavaScriptSerializer json=new JavaScriptSerializer();readonly NotifyIcon icon=new NotifyIcon();readonly System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer();
    readonly object audioLock=new object();readonly Queue<byte[]> ring=new Queue<byte[]>();readonly List<byte[]> captured=new List<byte[]>();
    Process worker,python,backend,tts;SpeechRecognitionEngine recognition;SpeechSynthesizer synth=new SpeechSynthesizer();SoundPlayer player;AudioInput microphone;PcmStream stream;
    Dictionary<string,object> config;string phase="Starting",error="",language="auto",replyLanguage="auto",voiceName="";bool paused,closing,connected,modelReady,speaking,speechStarted,followup,calibrating;int generation,recordingId,ringBytes,wakeHits,micDevice=-1;double rms,peak,threshold=350,confidence=0.62;
    DateTime captureAt,lastVoice,lastAudio=DateTime.UtcNow,retryAt=DateTime.MinValue,lastBackend=DateTime.MinValue;double followupSeconds=6;string lastAudioPath="",wakeAudioPath="";int activeId;
    const string Pipe="LUCIFER.Native.micha";
    bool afterReply;
    bool pauseHotkey,stopHotkey;
    bool pauseShift,summonShift;
    string latestStatus="{}";
    string lastTaskId="";readonly Dictionary<Process,StreamWriter> inputs=new Dictionary<Process,StreamWriter>();
    int calibrationId;Label calibrationLabel;
    bool wakeCollecting,wakePending,microphoneTest,talkPending,testOutput;int wakeJobId;DateTime wakeStarted,lastWakeVoice;readonly List<byte[]> wakeAudio=new List<byte[]>();string lastTranscript="",lastResult="",voiceEvent="Ready";
    readonly Dictionary<string,Icon> stateIcons=new Dictionary<string,Icon>();Form settingsWindow;AssistantOverlay overlay;Action acknowledgementNext;bool showSettings;string iconState="";bool summonHotkey,confirmationPending;
    [System.Runtime.InteropServices.DllImport("user32.dll",CharSet=System.Runtime.InteropServices.CharSet.Unicode)]static extern uint RegisterWindowMessage(string message);
    readonly uint taskbarCreated=RegisterWindowMessage("TaskbarCreated");
    public Tray(string project,bool openSettings){root=project;dir=Path.Combine(root,".local","native");showSettings=openSettings;ShowInTaskbar=false;WindowState=FormWindowState.Minimized;FormBorderStyle=FormBorderStyle.FixedToolWindow;Load+=delegate{Hide();};Directory.CreateDirectory(Path.Combine(dir,"audio"));config=ReadConfig();LoadSettings();
      foreach(string state in new[]{"Listening","Paused","Working","Error"})stateIcons[state]=BrandIcon.Create(state);overlay=new AssistantOverlay(root,delegate(string text){StopCurrent();overlay.ShowPassive();Dispatch(text);},delegate{ManualTalk(false);},delegate{StopCurrent();});
      var menu=new ContextMenuStrip();menu.Items.Add("LUCIFER - Starting").Name="state";menu.Items.Add("Open LUCIFER",null,delegate{Process.Start("http://localhost:3001");});menu.Items.Add("Pause / resume microphone",null,delegate{TogglePause();}).Name="pause";menu.Items.Add("Stop current action (Ctrl+Alt+Esc)",null,delegate{StopCurrent();});menu.Items.Add("Voice settings and microphone calibration",null,delegate{Settings();});menu.Items.Add("Grant an additional folder (owner confirmation)",null,delegate{GrantFolder();});menu.Items.Add("Enable Windows sign-in startup",null,delegate{Startup(true);});menu.Items.Add("Disable Windows sign-in startup",null,delegate{Startup(false);});menu.Items.Add("Exit",null,delegate{RequestExit();});icon.Icon=stateIcons["Working"];icon.Text="LUCIFER - Starting";icon.ContextMenuStrip=menu;icon.Visible=true;icon.DoubleClick+=delegate{Settings();};NativeLog.Write(root,"tray","icon.requested");
      synth.SpeakCompleted+=delegate(object sender,SpeakCompletedEventArgs e){if(e.Cancelled)return;Ui(delegate{if(closing||!speaking)return;if(phase=="Acknowledging"&&acknowledgementNext!=null){var next=acknowledgementNext;acknowledgementNext=null;speaking=false;lock(audioLock){ring.Clear();ringBytes=0;}voiceEvent="Acknowledgement complete";next();}else ReplyFinished();});};
      SystemEvents.PowerModeChanged+=PowerChanged;FormClosing+=Shutdown;var window=Handle;
      timer.Interval=100;timer.Tick+=Tick;timer.Start();Task.Run((Action)PipeServer);EnsureBackend();StartPython();StartWorker();if(!paused)StartMicrophone();
    }
    [System.Runtime.InteropServices.DllImport("user32.dll")]static extern bool RegisterHotKey(IntPtr h,int id,uint modifiers,uint key);
    [System.Runtime.InteropServices.DllImport("user32.dll")]static extern bool UnregisterHotKey(IntPtr h,int id);
    protected override void OnHandleCreated(EventArgs e){base.OnHandleCreated(e);pauseShift=false;pauseHotkey=RegisterHotKey(Handle,1,0x4003,0x4C);if(!pauseHotkey){pauseShift=true;pauseHotkey=RegisterHotKey(Handle,1,0x4007,0x4C);}stopHotkey=RegisterHotKey(Handle,2,0x4003,0x1B);summonShift=false;summonHotkey=RegisterHotKey(Handle,3,0x4003,0x20);if(!summonHotkey){summonShift=true;summonHotkey=RegisterHotKey(Handle,3,0x4007,0x20);}overlay.SetSummonShortcut(summonHotkey,summonShift);}
    protected override void WndProc(ref Message message){if(message.Msg==0x312){int hotkey=message.WParam.ToInt32();if(hotkey==1)TogglePause();else if(hotkey==2)StopCurrent();else if(hotkey==3)Summon();}if(message.Msg==taskbarCreated&&icon.ContextMenuStrip!=null)RefreshIcon("explorer.restart");base.WndProc(ref message);}
    void RefreshIcon(string reason){if(closing)return;icon.Visible=false;icon.Visible=true;NativeLog.Write(root,"tray","icon.refreshed",new {reason=reason});}
    void Ui(Action work){if(closing)return;try{BeginInvoke(work);}catch{}}
    Dictionary<string,object> ReadConfig(){return json.Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(dir,"runtime.json")));}
    string C(string key){return Convert.ToString(config[key]);}
    void LoadSettings(){try{var settings=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(dir,"voice-settings.json")));language=Convert.ToString(settings["language"]);voiceName=Convert.ToString(settings["voice"]);paused=Convert.ToBoolean(settings["paused"]);micDevice=Convert.ToInt32(settings["microphone"]);threshold=Convert.ToDouble(settings["threshold"]);confidence=Convert.ToDouble(settings["confidence"]);if(settings.ContainsKey("replyLanguage"))replyLanguage=Convert.ToString(settings["replyLanguage"]);}catch{}}
    void SaveSettings(){File.WriteAllText(Path.Combine(dir,"voice-settings.json"),json.Serialize(new {language=language,replyLanguage=replyLanguage,voice=voiceName,paused=paused,microphone=micDevice,threshold=threshold,confidence=confidence}));}
    bool Alive(Process process){try{return process!=null&&!process.HasExited;}catch{return false;}}
    void KillTree(Process process){if(!Alive(process))return;try{using(var killer=Process.Start(new ProcessStartInfo("taskkill.exe","/PID "+process.Id+" /T /F"){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true})){killer.BeginOutputReadLine();killer.BeginErrorReadLine();killer.WaitForExit(5000);}}catch{try{process.Kill();}catch{}}}
    Process Child(string executable,string arguments,Action<Dictionary<string,object>> onLine){var info=new ProcessStartInfo(executable,arguments){WorkingDirectory=root,UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8};var process=new Process{StartInfo=info};process.OutputDataReceived+=delegate(object sender,DataReceivedEventArgs e){if(e.Data==null)return;try{var value=json.Deserialize<Dictionary<string,object>>(e.Data);Ui(delegate{onLine(value);});}catch{}};process.ErrorDataReceived+=delegate{};process.Start();lock(inputs){inputs[process]=new StreamWriter(process.StandardInput.BaseStream,new UTF8Encoding(false)){AutoFlush=true};}process.Exited+=delegate{lock(inputs){StreamWriter input;if(inputs.TryGetValue(process,out input)){try{input.Dispose();}catch{}inputs.Remove(process);}}};process.EnableRaisingEvents=true;process.BeginOutputReadLine();process.BeginErrorReadLine();return process;}
    void Send(Process process,object message){if(!Alive(process))return;try{lock(inputs){StreamWriter input;if(inputs.TryGetValue(process,out input))input.WriteLine(json.Serialize(message));}}catch{}}
    void StartPython(){try{modelReady=false;python=Child(C("python"),"-X utf8 -u \""+Path.Combine(root,"companion","native","speech_worker.py")+"\"",PythonLine);}catch{error="Local transcription runtime failed to start. Run native setup again.";}}
    void StartWorker(){try{connected=false;worker=Child(C("node"),"\""+Path.Combine(dir,"companion-worker.cjs")+"\"",WorkerLine);}catch{error="Windows companion could not start.";}}
    void EnsureBackend(){lastBackend=DateTime.UtcNow;Task.Run(delegate{try{using(var web=new System.Net.WebClient()){web.DownloadString("http://127.0.0.1:3001/api/health");return;}}catch{}if(Alive(backend))return;try{var info=new ProcessStartInfo("wsl.exe","-d "+C("distribution")+" --cd \""+C("wslRoot")+"\" -- bash .local/native/start-backend.sh"){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true};backend=Process.Start(info);backend.OutputDataReceived+=delegate{};backend.ErrorDataReceived+=delegate{};backend.BeginOutputReadLine();backend.BeginErrorReadLine();}catch{Ui(delegate{error="Production backend startup failed. Check WSL readiness in native diagnostics.";});}});}
    void StartMicrophone(){if(paused||closing||microphone!=null)return;try{microphone=new AudioInput(micDevice);microphone.Frame+=Audio;error="";phase="Wake";voiceEvent="Local utterance wake detector ready";lastAudio=DateTime.UtcNow;}catch(Exception e){error=e.Message;CloseMicrophone();retryAt=DateTime.UtcNow.AddSeconds(10);}}
    void CloseMicrophone(){if(microphone!=null){microphone.Dispose();microphone=null;}if(stream!=null){stream.Dispose();stream=null;}if(recognition!=null){try{recognition.RecognizeAsyncCancel();recognition.Dispose();}catch{}recognition=null;}lock(audioLock){ring.Clear();ringBytes=0;captured.Clear();}}
    void Audio(byte[] data,double level){lastAudio=DateTime.UtcNow;rms=level;peak=Math.Max(peak,level);lock(audioLock){ring.Enqueue(data);ringBytes+=data.Length;while(ringBytes>64000){ringBytes-=ring.Dequeue().Length;}double gate=Math.Max(80,Math.Min(250,threshold*0.5));if(phase=="Wake"&&!paused&&!speaking&&!calibrating&&!wakePending&&modelReady){if(!wakeCollecting&&level>=gate){wakeCollecting=true;wakeStarted=lastWakeVoice=DateTime.UtcNow;wakeAudio.Clear();wakeAudio.AddRange(ring.ToArray());}else if(wakeCollecting)wakeAudio.Add(data);if(wakeCollecting&&level>=gate)lastWakeVoice=DateTime.UtcNow;}if(phase=="Capture"||(calibrating&&calibrationId==0)){captured.Add(data);if(level>=gate){speechStarted=true;lastVoice=DateTime.UtcNow;}}}}
    void FinishWake(){byte[] data;lock(audioLock){data=wakeAudio.SelectMany(x=>x).ToArray();wakeAudio.Clear();wakeCollecting=false;}if(data.Length<6400)return;wakePending=true;voiceEvent="Checking a local utterance for Lucifer; ambient text is not sent";wakeJobId=++recordingId;wakeAudioPath=Path.Combine(dir,"audio",Guid.NewGuid().ToString("N")+".wav");AudioInput.SaveWav(wakeAudioPath,data);NativeLog.Write(root,"tray","wake.submitted",new {milliseconds=data.Length/32});Send(python,new {id=wakeJobId,path=wakeAudioPath,language="auto",mode="wake"});}
    void Cue(){voiceEvent="Wake accepted";Task.Run(delegate{try{string file=Path.Combine(dir,"audio","cue.wav");if(!File.Exists(file)){byte[] pcm=new byte[6400];for(int i=0;i<pcm.Length/2;i++){short sample=(short)(Math.Sin(i*2*Math.PI*880/16000)*4500*Math.Sin(Math.PI*i/(pcm.Length/2)));pcm[i*2]=(byte)sample;pcm[i*2+1]=(byte)(sample>>8);}AudioInput.SaveWav(file,pcm);}using(var sound=new SoundPlayer(file))sound.PlaySync();}catch{Ui(delegate{error="Wake cue playback failed. Use Test speaker.";});}});}
    void Acknowledge(Action next){if(closing)return;phase="Acknowledging";speaking=true;voiceEvent="Wake accepted · local Yes boss acknowledgement";overlay.ShowPassive();acknowledgementNext=next;try{if(!String.IsNullOrWhiteSpace(voiceName))synth.SelectVoice(voiceName);synth.SpeakAsync("Yes boss");}catch{acknowledgementNext=null;speaking=false;error="Local Yes boss playback failed. Use Test speaker.";if(next!=null)next();}}
    void Summon(){StopCurrent();overlay.ShowPassive();Acknowledge(delegate{ManualTalk(false);});}
    void ManualTalk(bool test){StopCurrent();overlay.ShowPassive();microphoneTest=test;talkPending=true;if(paused){paused=false;SaveSettings();StartMicrophone();}voiceEvent="Preparing local microphone and transcription";}
    void Recognized(object sender,SpeechRecognizedEventArgs e){if(e.Result.Confidence<confidence||paused||speaking)return;Ui(delegate{if(e.Result.Text.StartsWith("Lucifer",StringComparison.OrdinalIgnoreCase))wakeHits++;if(calibrating)return;if(paused||speaking)return;if(e.Result.Text=="stop"&&new[]{"Capture","Working","Transcribing"}.Contains(phase)){StopCurrent();return;}if(phase=="Wake"&&connected&&modelReady&&e.Result.Text.StartsWith("Lucifer",StringComparison.OrdinalIgnoreCase))BeginCapture(false);});}
    void BeginCapture(bool follow){if(paused||(!connected&&!microphoneTest)||!modelReady)return;followup=follow;speechStarted=!follow;captureAt=lastVoice=DateTime.UtcNow;phase="Capture";lock(audioLock){captured.Clear();if(!follow)captured.AddRange(ring.ToArray());}if(!follow)Cue();}
    void FinishCapture(){byte[] data;lock(audioLock){data=captured.SelectMany(x=>x).ToArray();captured.Clear();}if(data.Length<6400){phase="Wake";return;}phase="Transcribing";activeId=++recordingId;lastAudioPath=Path.Combine(dir,"audio",Guid.NewGuid().ToString("N")+".wav");AudioInput.SaveWav(lastAudioPath,data);Send(python,new {id=activeId,path=lastAudioPath,language=language});}
    void PythonLine(Dictionary<string,object> message){
      string kind=Convert.ToString(message["kind"]);if(kind=="ready"){modelReady=true;if(connected&&microphone!=null)error="";return;}if(kind=="error"){wakePending=false;error="Local transcription failed. Check audio calibration.";calibrating=false;phase="Wake";if(calibrationLabel!=null&&!calibrationLabel.IsDisposed)calibrationLabel.Text=error;return;}
      if(kind=="wake"&&Convert.ToInt32(message["id"])==wakeJobId){wakePending=false;if(paused||speaking||calibrating||phase!="Wake")return;bool accepted=Convert.ToBoolean(message["wake"]);NativeLog.Write(root,"tray","wake.result",new {accepted=accepted});if(!accepted)return;wakeHits++;string command=Convert.ToString(message["text"]);overlay.ShowPassive();if(String.IsNullOrWhiteSpace(command))Acknowledge(delegate{BeginCapture(true);speechStarted=false;voiceEvent="Wake accepted; give your instruction";});else Acknowledge(delegate{Dispatch(command);});return;}
      if(kind=="transcript"&&calibrating&&Convert.ToInt32(message["id"])==calibrationId){calibrating=false;if(message.ContainsKey("wake")&&Convert.ToBoolean(message["wake"]))wakeHits++;lastTranscript=Convert.ToString(message["text"]);voiceEvent="Local calibration transcript ready; no action ran";if(calibrationLabel!=null&&!calibrationLabel.IsDisposed)calibrationLabel.Text="Local wake detections: "+wakeHits+"; threshold: "+Math.Round(threshold)+". Transcript: "+lastTranscript+". Confirm it matches what you said.";return;}
      if(kind!="transcript"||phase!="Transcribing"||Convert.ToInt32(message["id"])!=activeId)return;
      string text=Convert.ToString(message["text"]);var matches=Regex.Matches(text,"(?:lucifer|லூசிபர்|லூசிஃபர்)[\\s,.:]*",RegexOptions.IgnoreCase);
      lastTranscript=text;if(microphoneTest){microphoneTest=false;phase="Wake";voiceEvent="Microphone transcript ready; no action ran";return;}
      if(matches.Count>0){var match=matches[matches.Count-1];text=text.Substring(match.Index+match.Length).Trim();}
      else if(!followup){Speak("I could not separate the wake word from the command. Please say Lucifer followed by the command again.");return;}
      Dispatch(text);
    }
    void Dispatch(string text){
      confirmationPending=false;overlay.ShowPassive();overlay.SetTranscript(text);lastTranscript=text;if(String.IsNullOrWhiteSpace(text)){phase="Wake";return;}
      if(Regex.IsMatch(text.Trim(),"^(stop|cancel|நிறுத்து|நிறுத்துங்கள்)[.!? ]*$",RegexOptions.IgnoreCase)){StopCurrent();return;}
      if(text.Contains("தமிழில் பேசு")||Regex.IsMatch(text,"speak tamil|tamilil pesu",RegexOptions.IgnoreCase)){replyLanguage="ta";SaveSettings();Speak("வணக்கம். இனி தமிழில் பேசுகிறேன்.");return;}
      if(text.ToLowerInvariant().Contains("speak english")){replyLanguage="en";SaveSettings();Speak("I will speak English.");return;}
      activeId=++recordingId;phase="Working";voiceEvent="Executing activated instruction";Send(worker,new {kind="command",id=activeId,text=text,replyLanguage=replyLanguage});
    }
    void WorkerLine(Dictionary<string,object> message){
      string kind=Convert.ToString(message["kind"]);
      if(kind=="ready"){
        if(!connected&&microphone!=null&&modelReady)error="";connected=true;
        if(Convert.ToBoolean(message["emergency"])){if(!paused){paused=true;SaveSettings();StopCurrent();CloseMicrophone();}error="Dashboard emergency stop is active. Resume actions there before voice use.";}return;
      }
      if(kind=="disconnected"){connected=false;error=Convert.ToString(message["error"]);return;}
      if(kind=="control"){string action=Convert.ToString(message["action"]);Control(action);return;}
      if(kind=="progress"&&phase=="Working"&&Convert.ToInt32(message["id"])==activeId){string progressState=message.ContainsKey("state")?Convert.ToString(message["state"]):"";confirmationPending=progressState=="awaiting_authorization"||progressState=="awaiting_input";voiceEvent=message.ContainsKey("detail")?Convert.ToString(message["detail"]):"Backend task is running";if(message.ContainsKey("taskId"))lastTaskId=Convert.ToString(message["taskId"]);return;}
      if(kind=="reply"&&phase=="Working"&&Convert.ToInt32(message["id"])==activeId){if(message.ContainsKey("taskId"))lastTaskId=Convert.ToString(message["taskId"]);string taskState=message.ContainsKey("state")?Convert.ToString(message["state"]):"";confirmationPending=taskState=="awaiting_authorization"||taskState=="awaiting_input";string result=message.ContainsKey("error")?Convert.ToString(message["error"]):Convert.ToString(message["reply"]);overlay.SetResult(String.IsNullOrWhiteSpace(result)?"No confirmed response was returned.":result);Speak(String.IsNullOrWhiteSpace(result)?"No confirmed response was returned.":result);}
    }
    void Speak(string text){
      lastResult=text;voiceEvent="Playing local reply";phase="Speaking";speaking=true;int version=++generation;text=text.Length>1200?text.Substring(0,1200):text;
      if(Regex.IsMatch(text,"[\\u0b80-\\u0bff]"))Task.Run(delegate{
        string file=Path.Combine(dir,"audio",Guid.NewGuid().ToString("N")+".wav"),input=file+".txt";
        try{
          File.WriteAllText(input,text,new UTF8Encoding(false));
          var info=new ProcessStartInfo(C("espeak"),"-v ta -b 1 -s 145 -w \""+file+"\" -f \""+input+"\""){WorkingDirectory=Path.GetDirectoryName(C("espeak")),UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true};
          info.EnvironmentVariables["ESPEAK_DATA_PATH"]=Path.GetDirectoryName(C("espeak"));
          tts=Process.Start(info);tts.BeginOutputReadLine();tts.BeginErrorReadLine();if(!tts.WaitForExit(15000)){KillTree(tts);throw new Exception();}if(tts.ExitCode!=0)throw new Exception();if(version!=generation)return;player=new SoundPlayer(file);player.PlaySync();
        }catch{Ui(delegate{if(version==generation)error="Tamil speech output failed. Transcript remains in dashboard history.";});}
        finally{try{File.Delete(file);File.Delete(input);}catch{}Ui(delegate{if(version==generation)ReplyFinished();});}
      });
      else try{if(!String.IsNullOrWhiteSpace(voiceName))synth.SelectVoice(voiceName);synth.SpeakAsync(text);}catch{error="Windows voice output failed.";ReplyFinished();}
    }
    void ReplyFinished(){speaking=false;afterReply=!testOutput;testOutput=false;phase="Cooldown";retryAt=DateTime.UtcNow.AddMilliseconds(750);lock(audioLock){ring.Clear();ringBytes=0;}if(paused)phase="Wake";}
    void TogglePause(){paused=!paused;SaveSettings();StopCurrent();if(paused)CloseMicrophone();else StartMicrophone();}
    void StopCurrent(){acknowledgementNext=null;confirmationPending=false;bool transcribing=phase=="Transcribing"||wakePending||(calibrating&&calibrationId!=0);wakePending=false;wakeCollecting=false;microphoneTest=false;talkPending=false;testOutput=false;wakeJobId=++recordingId;voiceEvent="Stopped";calibrating=false;calibrationId=0;generation++;activeId=++recordingId;speaking=false;afterReply=false;try{synth.SpeakAsyncCancelAll();if(player!=null)player.Stop();KillTree(tts);}catch{}Send(worker,new {kind="stop"});if(transcribing){KillTree(python);StartPython();}foreach(string file in new[]{lastAudioPath,wakeAudioPath})if(!String.IsNullOrWhiteSpace(file)){try{File.Delete(file);}catch{}}phase="Cooldown";retryAt=DateTime.UtcNow.AddMilliseconds(750);lock(audioLock){wakeAudio.Clear();captured.Clear();ring.Clear();ringBytes=0;}}
    void Control(string action){if(action=="stop")StopCurrent();else if(action=="pause"&&!paused)TogglePause();else if(action=="resume"&&paused)TogglePause();else if(action=="talk")ManualTalk(false);else if(action=="test-microphone")ManualTalk(true);else if(action=="test-speaker"){StopCurrent();testOutput=true;Speak("LUCIFER speaker test. You should hear this sentence.");}else if(action=="settings")Settings();else if(action=="grant-folder")GrantFolder();}
    void Tick(object sender,EventArgs e){if(closing)return;if(showSettings){showSettings=false;Settings();}if((DateTime.UtcNow-lastBackend).TotalSeconds>10)EnsureBackend();if(!Alive(worker)&&DateTime.UtcNow>retryAt){StartWorker();retryAt=DateTime.UtcNow.AddSeconds(5);}if(!Alive(python)&&DateTime.UtcNow>retryAt){StartPython();retryAt=DateTime.UtcNow.AddSeconds(10);}if(!paused&&microphone==null&&DateTime.UtcNow>retryAt)StartMicrophone();if(microphone!=null&&(DateTime.UtcNow-lastAudio).TotalSeconds>8){CloseMicrophone();error="Microphone disconnected; retrying local input.";retryAt=DateTime.UtcNow.AddSeconds(10);}if(phase=="Capture"){double elapsed=(DateTime.UtcNow-captureAt).TotalSeconds;if(!speechStarted&&elapsed>followupSeconds)phase="Wake";else if(speechStarted&&((DateTime.UtcNow-lastVoice).TotalMilliseconds>1100||elapsed>20))FinishCapture();}if(phase=="Cooldown"&&DateTime.UtcNow>retryAt){if(afterReply&&!paused&&connected&&modelReady)BeginCapture(true);else phase="Wake";afterReply=false;}
      if(talkPending&&modelReady&&connected&&microphone!=null&&!paused){talkPending=false;BeginCapture(true);speechStarted=false;voiceEvent=microphoneTest?"Microphone test: speak; no action will execute":"Talk now";}
      if(wakePending&&(DateTime.UtcNow-wakeStarted).TotalSeconds>50){StopCurrent();error="Local wake transcription timed out and was restarted. Use Test microphone.";}
      if(wakeCollecting&&!wakePending&&phase=="Wake"&&((DateTime.UtcNow-lastWakeVoice).TotalMilliseconds>600||(DateTime.UtcNow-wakeStarted).TotalSeconds>8))FinishWake();
      string state=paused?"Paused":(!connected||!modelReady||microphone==null||error!="")?"Error":(phase=="Working"||phase=="Speaking"||phase=="Transcribing"||phase=="Acknowledging")?"Working":"Listening";string detail=paused?"Microphone closed":phase=="Capture"?(followup?"Follow-up window · 6 seconds":"Command capture · silence endpoint"):phase=="Wake"?"Local Lucifer wake word":phase;string panelState=confirmationPending&&phase!="Speaking"?"Confirmation required":error!=""?"Error":paused?"Idle":(!connected||!modelReady||microphone==null)?"Offline":phase=="Capture"?"Listening":phase=="Transcribing"?"Understanding":phase=="Working"?"Working":(phase=="Speaking"||phase=="Acknowledging")?"Speaking":"Idle";overlay.UpdateRuntime(panelState,error!=""?error:voiceEvent,lastTranscript,lastResult,rms);
      icon.Text="LUCIFER - "+state;icon.ContextMenuStrip.Items["state"].Text="LUCIFER - "+state+" - "+detail;if(iconState!=state){iconState=state;icon.Icon=stateIcons[state];NativeLog.Write(root,"tray","state.changed",new {state=state});}
      icon.ContextMenuStrip.Items["pause"].Text="Pause / resume microphone ("+(pauseHotkey?(pauseShift?"Ctrl+Alt+Shift+L":"Ctrl+Alt+L"):"tray control")+")";
      if(DateTime.UtcNow.Millisecond<120){var value=new {state=state,detail=error!=""?error:voiceEvent,microphone=microphone!=null,modelReady=modelReady,transcript=lastTranscript,result=lastResult,wakeHits=wakeHits,phase=phase};Send(worker,new {kind="status",status=value});latestStatus=json.Serialize(new {state=state,phase=phase,lastTaskId=lastTaskId,detail=error!=""?error:voiceEvent,microphone=microphone!=null,modelReady=modelReady,connected=connected,processId=Process.GetCurrentProcess().Id,sessionId=Process.GetCurrentProcess().SessionId,windowStation=NativeDesktop.Station,desktop=NativeDesktop.Desktop,tooltip=icon.Text,settingsOpen=settingsWindow!=null&&!settingsWindow.IsDisposed&&settingsWindow.Visible,workerId=Alive(worker)?worker.Id:0,pythonId=Alive(python)?python.Id:0,rms=rms,peak=peak,wakeHits=wakeHits,startup=StartupEnabled(),pauseHotkey=pauseHotkey,pauseShortcut=pauseShift?"Ctrl+Alt+Shift+L":"Ctrl+Alt+L",stopHotkey=stopHotkey,summonHotkey=summonHotkey,summonShortcut=summonHotkey?(summonShift?"Ctrl+Alt+Shift+Space":"Ctrl+Alt+Space"):"tray/Talk",updatedAt=DateTime.UtcNow.ToString("o")});try{File.WriteAllText(Path.Combine(dir,"status.json"),latestStatus);}catch{}}
    }
    bool StartupEnabled(){using(var key=Registry.CurrentUser.OpenSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Run")){return key!=null&&key.GetValue("LUCIFER Assistant")!=null;}}
    void Startup(bool enable){using(var key=Registry.CurrentUser.CreateSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Run")){if(enable)key.SetValue("LUCIFER Assistant","\""+Application.ExecutablePath+"\" --supervise");else key.DeleteValue("LUCIFER Assistant",false);}icon.ShowBalloonTip(3000,"LUCIFER",enable?"Startup enabled at this owner's Windows sign-in.":"Windows sign-in startup disabled.",ToolTipIcon.Info);}
    void GrantFolder(){using(var picker=new FolderBrowserDialog{Description="Choose a folder to grant read/search and creation of new .txt notes (no overwrite or deletion)."}){if(picker.ShowDialog()!=DialogResult.OK)return;if(MessageBox.Show("Grant LUCIFER read/search/create access inside "+picker.SelectedPath+"? Private application credentials remain blocked.","Confirm folder access",MessageBoxButtons.YesNo)!=DialogResult.Yes)return;var policy=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(dir,"policy.json")));var folders=(Dictionary<string,object>)policy["folders"];string alias=Regex.Replace(Path.GetFileName(picker.SelectedPath).ToLowerInvariant(),"[^a-z0-9_-]","-");if(alias.Length<1)alias="folder";if(alias.Length>40)alias=alias.Substring(0,40);while(folders.ContainsKey(alias))alias+="-new";folders[alias]=picker.SelectedPath;File.WriteAllText(Path.Combine(dir,"policy.json"),json.Serialize(policy),new UTF8Encoding(false));icon.ShowBalloonTip(3000,"Folder granted",alias+" is now available to the native device tools.",ToolTipIcon.Info);}}
    void PowerChanged(object sender,PowerModeChangedEventArgs e){Ui(delegate{if(e.Mode==PowerModes.Suspend){StopCurrent();CloseMicrophone();}else if(e.Mode==PowerModes.Resume){error="";retryAt=DateTime.MinValue;if(!paused)StartMicrophone();EnsureBackend();}});}
    void Settings(){
      if(settingsWindow!=null&&!settingsWindow.IsDisposed){settingsWindow.WindowState=FormWindowState.Normal;settingsWindow.Show();settingsWindow.BringToFront();settingsWindow.Activate();NativeDesktop.SetForegroundWindow(settingsWindow.Handle);return;}
      var dialog=new Form{Text="LUCIFER - Voice settings and calibration",Width=600,Height=660,StartPosition=FormStartPosition.CenterScreen,Icon=(Icon)stateIcons["Listening"].Clone(),ShowInTaskbar=true};settingsWindow=dialog;
      var panel=new FlowLayoutPanel{Dock=DockStyle.Fill,FlowDirection=FlowDirection.TopDown,Padding=new Padding(15),AutoScroll=true,WrapContents=false};dialog.Controls.Add(panel);
      panel.Controls.Add(new Label{Text="Wake and commands: local multilingual Whisper small/int8.\nAmbient utterances stay local. Tamil output: local eSpeak (robotic).",Width=550,Height=48});
      var langs=new ComboBox{Width=350,DropDownStyle=ComboBoxStyle.DropDownList};langs.Items.AddRange(new object[]{"auto","en","ta"});langs.SelectedItem=language;
      panel.Controls.Add(new Label{Text="Transcription language (auto permits code switching)",Width=500});panel.Controls.Add(langs);
      var replies=new ComboBox{Width=350,DropDownStyle=ComboBoxStyle.DropDownList};replies.Items.AddRange(new object[]{"auto","en","ta"});replies.SelectedItem=replyLanguage;
      panel.Controls.Add(new Label{Text="Reply language (auto matches your instruction)",Width=500});panel.Controls.Add(replies);
      var voices=new ComboBox{Width=450,DropDownStyle=ComboBoxStyle.DropDownList};voices.Items.Add("");foreach(var installed in synth.GetInstalledVoices())voices.Items.Add(installed.VoiceInfo.Name);voices.SelectedItem=voiceName;
      panel.Controls.Add(new Label{Text="English system voice (Tamil uses eSpeak ta)",Width=500});panel.Controls.Add(voices);
      panel.Controls.Add(new Label{Text="Microphone input",Width=500});var microphones=new ComboBox{Width=450,DropDownStyle=ComboBoxStyle.DropDownList,AccessibleName="Microphone input"};microphones.Items.AddRange(AudioInput.Devices());microphones.SelectedIndex=Math.Min(microphones.Items.Count-1,micDevice+1);panel.Controls.Add(microphones);
      var statusLabel=new Label{Width=540,Height=110,Text="Calibration: 2 seconds quiet, then say Lucifer and a Tamil/English sentence. Audio is transcribed locally and deleted; no command executes."};panel.Controls.Add(statusLabel);
      var calibrate=new Button{Text="Calibrate microphone · 10 seconds",Width=300};panel.Controls.Add(calibrate);
      calibrate.Click+=async delegate{
        if(calibrating||!modelReady){statusLabel.Text="Wait until the local transcription model is ready.";return;}
        StopCurrent();language=Convert.ToString(langs.SelectedItem);micDevice=microphones.SelectedIndex-1;paused=false;CloseMicrophone();StartMicrophone();if(microphone==null){statusLabel.Text=error;return;}
        calibrating=true;peak=0;wakeHits=0;calibrationLabel=statusLabel;statusLabel.Text="Remain quiet for 2 seconds to measure background noise.";
        await Task.Delay(2000);if(!calibrating||statusLabel.IsDisposed){calibrating=false;return;}
        threshold=Math.Max(120,Math.Min(600,rms*2+80));peak=0;lock(audioLock){captured.Clear();}statusLabel.Text="Now say Lucifer, then a short Tamil or English sentence. No action will run.";
        await Task.Delay(8000);if(!calibrating||statusLabel.IsDisposed){calibrating=false;return;}
        byte[] sample;lock(audioLock){sample=captured.SelectMany(x=>x).ToArray();captured.Clear();}
        calibrationId=++recordingId;lastAudioPath=Path.Combine(dir,"audio",Guid.NewGuid().ToString("N")+".wav");AudioInput.SaveWav(lastAudioPath,sample);SaveSettings();statusLabel.Text="Transcribing the calibration sample locally...";Send(python,new {id=calibrationId,path=lastAudioPath,language=language});
      };
      var save=new Button{Text="Save language, voice and microphone",Width=330};panel.Controls.Add(save);
      save.Click+=delegate{language=Convert.ToString(langs.SelectedItem);replyLanguage=Convert.ToString(replies.SelectedItem);voiceName=Convert.ToString(voices.SelectedItem);micDevice=microphones.SelectedIndex-1;SaveSettings();StopCurrent();CloseMicrophone();if(!paused)StartMicrophone();dialog.Close();};
      dialog.FormClosed+=delegate{calibrating=false;settingsWindow=null;dialog.Icon.Dispose();lock(audioLock){captured.Clear();}NativeLog.Write(root,"tray","settings.closed");};dialog.Show();dialog.BringToFront();dialog.Activate();microphones.Focus();NativeDesktop.SetForegroundWindow(dialog.Handle);NativeLog.Write(root,"tray","settings.opened");
    }
    void PipeServer(){
      while(!closing){
        try{
          var security=new PipeSecurity();security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User,PipeAccessRights.FullControl,AccessControlType.Allow));
          using(var pipe=new NamedPipeServerStream(Pipe,PipeDirection.InOut,1,PipeTransmissionMode.Byte,PipeOptions.None,4096,4096,security)){
            pipe.WaitForConnection();
            using(var reader=new StreamReader(pipe,Encoding.UTF8,false,4096,true))using(var writer=new StreamWriter(pipe,new UTF8Encoding(false),4096,true)){
              writer.AutoFlush=true;var request=json.Deserialize<Dictionary<string,object>>(reader.ReadLine());string action=Convert.ToString(request["action"]);
               if(action=="state")writer.WriteLine(latestStatus);
              else{
                 Ui(delegate{if(action=="exit")RequestExit();else if(action=="refresh-icon")RefreshIcon("owner.request");else if(action=="startup-on")Startup(true);else if(action=="startup-off")Startup(false);else if(action=="command"){StopCurrent();Dispatch(Convert.ToString(request["text"]));}else Control(action);});
                writer.WriteLine("{\"accepted\":true}");
              }
            }
          }
        }catch{Thread.Sleep(250);}
      }
    }
    void RequestExit(){Environment.ExitCode=10;Close();}
    void Shutdown(object sender,FormClosingEventArgs e){if(e.CloseReason==CloseReason.WindowsShutDown)Environment.ExitCode=10;closing=true;timer.Stop();generation++;if(settingsWindow!=null&&!settingsWindow.IsDisposed)settingsWindow.Close();if(overlay!=null&&!overlay.IsDisposed)overlay.Dispose();CloseMicrophone();try{synth.SpeakAsyncCancelAll();synth.Dispose();if(player!=null)player.Stop();KillTree(tts);Send(worker,new {kind="exit"});if(Alive(worker)&&!worker.WaitForExit(3000))KillTree(worker);KillTree(python);}catch{}UnregisterHotKey(Handle,1);UnregisterHotKey(Handle,2);UnregisterHotKey(Handle,3);SystemEvents.PowerModeChanged-=PowerChanged;icon.Visible=false;icon.Dispose();foreach(var image in stateIcons.Values)image.Dispose();NativeLog.Write(root,"tray","process.exit");}
  }
}
