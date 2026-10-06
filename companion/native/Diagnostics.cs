using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;

namespace LuciferNative {
  static class NativeDesktop {
    [DllImport("user32.dll")]static extern IntPtr GetProcessWindowStation();
    [DllImport("user32.dll")]static extern IntPtr GetThreadDesktop(uint thread);
    [DllImport("kernel32.dll")]static extern uint GetCurrentThreadId();
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern bool GetUserObjectInformation(IntPtr handle,int index,StringBuilder text,int size,out int needed);
    [DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")]static extern bool AllowSetForegroundWindow(uint pid);
    [DllImport("shell32.dll",CharSet=CharSet.Unicode)]static extern int SetCurrentProcessExplicitAppUserModelID(string id);
    static string Name(IntPtr handle){var text=new StringBuilder(256);int needed;return GetUserObjectInformation(handle,2,text,512,out needed)?text.ToString():"unavailable";}
    public static string Station{get{return Name(GetProcessWindowStation());}}
    public static string Desktop{get{return Name(GetThreadDesktop(GetCurrentThreadId()));}}
    public static void Identify(){SetCurrentProcessExplicitAppUserModelID("LUCIFER.Assistant");}
    public static bool Control(string action){
      try{
        using(var pipe=new NamedPipeClientStream(".","LUCIFER.Native."+Environment.UserName,PipeDirection.InOut)){
          pipe.Connect(3000);using(var writer=new StreamWriter(pipe,new UTF8Encoding(false),4096,true))using(var reader=new StreamReader(pipe,Encoding.UTF8,false,4096,true)){writer.AutoFlush=true;writer.WriteLine("{\"action\":\"state\"}");var state=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(reader.ReadLine());object pid;if(state.TryGetValue("processId",out pid))AllowSetForegroundWindow(Convert.ToUInt32(pid));}
        }
        using(var pipe=new NamedPipeClientStream(".","LUCIFER.Native."+Environment.UserName,PipeDirection.InOut)){
          pipe.Connect(3000);using(var writer=new StreamWriter(pipe,new UTF8Encoding(false),4096,true))using(var reader=new StreamReader(pipe,Encoding.UTF8,false,4096,true)){writer.AutoFlush=true;writer.WriteLine(new JavaScriptSerializer().Serialize(new {action=action}));reader.ReadLine();}
        }
        return true;
      }catch{return false;}
    }
  }
  static class NativeLog {
    static readonly object sync=new object();
    public static void Write(string root,string role,string eventName,object data=null){
      // Only caller-selected metadata is accepted. Never log messages, audio,
      // model responses, credentials, environment variables or exception text.
      try{lock(sync){var file=Path.Combine(root,".local","native",role+"-events.jsonl");if(File.Exists(file)&&new FileInfo(file).Length>1048576){string previous=file+".previous";if(File.Exists(previous))File.Delete(previous);File.Move(file,previous);}File.AppendAllText(file,new JavaScriptSerializer().Serialize(new {at=DateTime.UtcNow.ToString("o"),eventName=eventName,pid=Process.GetCurrentProcess().Id,session=Process.GetCurrentProcess().SessionId,station=NativeDesktop.Station,desktop=NativeDesktop.Desktop,data=data})+Environment.NewLine,new UTF8Encoding(false));}}catch{}
    }
    public static void Failure(string root,string role,string eventName,Exception error){Write(root,role,eventName,new {exceptionType=error.GetType().Name,hresult=error.HResult});}
  }
}
