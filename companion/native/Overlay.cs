using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace LuciferNative {
  sealed class AssistantOverlay : Form {
    readonly string root;
    readonly JavaScriptSerializer json=new JavaScriptSerializer();
    readonly Action<string> submit;
    readonly Action talk;
    readonly Action stop;
    readonly Panel header=new Panel();
    readonly Panel contentPanel=new Panel();
    readonly Label title=new Label();
    readonly Label stateLabel=new Label();
    readonly Label detailLabel=new Label();
    readonly Label transcriptLabel=new Label();
    readonly Label resultLabel=new Label();
    readonly TextBox input=new TextBox();
    readonly Button sendButton=new Button();
    readonly Button talkButton=new Button();
    readonly Button stopButton=new Button();
    readonly Button collapseButton=new Button();
    readonly Label shortcutLabel=new Label();
    readonly RobotAvatar avatar=new RobotAvatar();
    readonly Waveform waveform=new Waveform();
    readonly Timer idleTimer=new Timer();
    bool collapsed;
    bool dragging;
    Point dragOrigin;
    Point windowOrigin;
    DateTime lastActive=DateTime.UtcNow;
    string currentState="Idle";
    const int ExpandedWidth=430;
    const int ExpandedHeight=520;
    const int LauncherSize=82;

    public AssistantOverlay(string project,Action<string> onSubmit,Action onTalk,Action onStop){
      root=project;submit=onSubmit;talk=onTalk;stop=onStop;
      Text="LUCIFER";FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;TopMost=true;
      StartPosition=FormStartPosition.Manual;AutoScaleMode=AutoScaleMode.Dpi;BackColor=Color.FromArgb(20,16,22);
      ForeColor=Color.White;Opacity=0.97;Width=ExpandedWidth;Height=ExpandedHeight;MinimumSize=new Size(LauncherSize,LauncherSize);
      Padding=new Padding(1);DoubleBuffered=true;

      header.Dock=DockStyle.Top;header.Height=112;header.BackColor=Color.FromArgb(28,22,31);header.Cursor=Cursors.SizeAll;
      header.MouseDown+=DragStart;header.MouseMove+=DragMove;header.MouseUp+=DragEnd;
      Controls.Add(header);

      avatar.Location=new Point(18,16);avatar.Size=new Size(72,72);avatar.LauncherClicked+=delegate{if(collapsed)Expand();};
      header.Controls.Add(avatar);
      title.Text="LUCIFER";title.Font=new Font("Segoe UI Semibold",16,FontStyle.Bold);title.AutoSize=true;title.Location=new Point(108,18);title.ForeColor=Color.FromArgb(248,238,244);
      title.MouseDown+=DragStart;title.MouseMove+=DragMove;title.MouseUp+=DragEnd;header.Controls.Add(title);
      stateLabel.Text="Idle";stateLabel.Font=new Font("Segoe UI",10,FontStyle.Bold);stateLabel.AutoSize=true;stateLabel.Location=new Point(110,53);stateLabel.ForeColor=Color.FromArgb(255,92,147);
      stateLabel.MouseDown+=DragStart;stateLabel.MouseMove+=DragMove;stateLabel.MouseUp+=DragEnd;header.Controls.Add(stateLabel);
      detailLabel.Text="Say Hey Lucifer";detailLabel.Font=new Font("Segoe UI",9);detailLabel.AutoEllipsis=true;detailLabel.Location=new Point(110,76);detailLabel.Size=new Size(250,24);detailLabel.ForeColor=Color.FromArgb(196,184,194);
      detailLabel.MouseDown+=DragStart;detailLabel.MouseMove+=DragMove;detailLabel.MouseUp+=DragEnd;header.Controls.Add(detailLabel);
      collapseButton.Text="—";collapseButton.FlatStyle=FlatStyle.Flat;collapseButton.FlatAppearance.BorderSize=0;collapseButton.ForeColor=Color.FromArgb(206,190,201);collapseButton.BackColor=Color.FromArgb(28,22,31);collapseButton.Size=new Size(38,34);collapseButton.Location=new Point(382,8);collapseButton.TabStop=true;collapseButton.AccessibleName="Collapse LUCIFER panel";collapseButton.Click+=delegate{Collapse();};header.Controls.Add(collapseButton);

      contentPanel.Dock=DockStyle.Fill;contentPanel.Padding=new Padding(18,12,18,16);contentPanel.BackColor=Color.FromArgb(20,16,22);Controls.Add(contentPanel);
      waveform.Location=new Point(18,8);waveform.Size=new Size(392,64);contentPanel.Controls.Add(waveform);

      var recognized=new Label{Text="RECOGNIZED COMMAND",Font=new Font("Segoe UI",8,FontStyle.Bold),ForeColor=Color.FromArgb(152,138,149),Location=new Point(18,82),AutoSize=true};
      contentPanel.Controls.Add(recognized);
      transcriptLabel.Text="—";transcriptLabel.Font=new Font("Nirmala UI",10);transcriptLabel.ForeColor=Color.FromArgb(242,233,239);transcriptLabel.Location=new Point(18,103);transcriptLabel.Size=new Size(392,48);transcriptLabel.AutoEllipsis=true;contentPanel.Controls.Add(transcriptLabel);

      var progress=new Label{Text="TASK PROGRESS / RESULT",Font=new Font("Segoe UI",8,FontStyle.Bold),ForeColor=Color.FromArgb(152,138,149),Location=new Point(18,163),AutoSize=true};
      contentPanel.Controls.Add(progress);
      resultLabel.Text="Ready.";resultLabel.Font=new Font("Nirmala UI",10);resultLabel.ForeColor=Color.FromArgb(214,203,211);resultLabel.Location=new Point(18,184);resultLabel.Size=new Size(392,62);resultLabel.AutoEllipsis=true;contentPanel.Controls.Add(resultLabel);

      input.Location=new Point(18,265);input.Size=new Size(300,31);input.Font=new Font("Nirmala UI",10);input.BorderStyle=BorderStyle.FixedSingle;input.BackColor=Color.FromArgb(37,30,41);input.ForeColor=Color.White;input.AccessibleName="Type a LUCIFER command";input.KeyDown+=delegate(object sender,KeyEventArgs e){if(e.KeyCode==Keys.Enter&&!e.Shift){e.SuppressKeyPress=true;SubmitText();}};contentPanel.Controls.Add(input);
      sendButton.Text="Send";sendButton.Location=new Point(326,263);sendButton.Size=new Size(84,34);StyleButton(sendButton,false);sendButton.Click+=delegate{SubmitText();};contentPanel.Controls.Add(sendButton);

      talkButton.Text="🎙 Talk";talkButton.Location=new Point(18,317);talkButton.Size=new Size(120,40);talkButton.AccessibleName="Talk to LUCIFER";StyleButton(talkButton,false);talkButton.Click+=delegate{MarkActive();ShowPassive();talk();};contentPanel.Controls.Add(talkButton);
      stopButton.Text="■ Stop";stopButton.Location=new Point(148,317);stopButton.Size=new Size(120,40);stopButton.AccessibleName="Stop LUCIFER";StyleButton(stopButton,true);stopButton.Click+=delegate{MarkActive();stop();};contentPanel.Controls.Add(stopButton);

      shortcutLabel.Text="Ctrl+Alt+Space summons · Ctrl+Alt+Esc stops";shortcutLabel.Font=new Font("Segoe UI",8);shortcutLabel.ForeColor=Color.FromArgb(136,122,133);shortcutLabel.Location=new Point(18,375);shortcutLabel.Size=new Size(392,28);shortcutLabel.TextAlign=ContentAlignment.MiddleLeft;contentPanel.Controls.Add(shortcutLabel);

      Paint+=delegate(object sender,PaintEventArgs e){using(var pen=new Pen(Color.FromArgb(78,255,73,132),1))e.Graphics.DrawRectangle(pen,0,0,Width-1,Height-1);};
      Resize+=delegate{ApplyRoundedRegion();};
      FormClosing+=delegate(object sender,FormClosingEventArgs e){if(e.CloseReason==CloseReason.UserClosing){e.Cancel=true;Collapse();}};
      Deactivate+=delegate{if(currentState=="Idle")MarkActive();};

      RestorePosition();
      idleTimer.Interval=1000;idleTimer.Tick+=delegate{if(!collapsed&&Visible&&currentState=="Idle"&&(DateTime.UtcNow-lastActive).TotalSeconds>=10)Collapse();};idleTimer.Start();
      ApplyRoundedRegion();
    }

    protected override bool ShowWithoutActivation { get { return true; } }

    static void StyleButton(Button button,bool danger){
      button.FlatStyle=FlatStyle.Flat;button.FlatAppearance.BorderSize=1;button.FlatAppearance.BorderColor=danger?Color.FromArgb(132,57,72):Color.FromArgb(124,53,82);
      button.BackColor=danger?Color.FromArgb(58,31,38):Color.FromArgb(55,31,46);button.ForeColor=danger?Color.FromArgb(255,194,203):Color.FromArgb(255,213,231);
      button.Font=new Font("Segoe UI Semibold",9,FontStyle.Bold);button.Cursor=Cursors.Hand;
    }

    void SubmitText(){
      string text=input.Text.Trim();if(text.Length==0)return;
      input.Clear();transcriptLabel.Text=text;resultLabel.Text="Sending through the validated assistant pipeline…";MarkActive();
      submit(text);
    }

    public void ShowPassive(){
      MarkActive();
      if(collapsed)Expand();
      EnsureVisibleOnScreen();
      if(!Visible)Show();
      else Invalidate();
    }

    public void UpdateRuntime(string state,string detail,string transcript,string result,double level){
      currentState=String.IsNullOrWhiteSpace(state)?"Idle":state;
      stateLabel.Text=currentState;detailLabel.Text=String.IsNullOrWhiteSpace(detail)?"Ready":detail;
      if(!String.IsNullOrWhiteSpace(transcript))transcriptLabel.Text=transcript;
      if(!String.IsNullOrWhiteSpace(result))resultLabel.Text=result;
      else if(currentState=="Working"||currentState=="Understanding")resultLabel.Text=detailLabel.Text;
      avatar.SetState(currentState);waveform.SetLevel(level,currentState);
      if(currentState!="Idle")MarkActive();
    }

    public void SetSummonShortcut(bool available){shortcutLabel.Text=available?"Ctrl+Alt+Space summons · Ctrl+Alt+Esc stops":"Summon shortcut unavailable · use tray/Talk · Ctrl+Alt+Esc stops";}
    public void SetResult(string text){if(!String.IsNullOrWhiteSpace(text))resultLabel.Text=text;MarkActive();}
    public void SetTranscript(string text){if(!String.IsNullOrWhiteSpace(text))transcriptLabel.Text=text;MarkActive();}

    public void Collapse(){
      if(collapsed)return;collapsed=true;MarkActive();SavePosition();
      contentPanel.Visible=false;title.Visible=false;stateLabel.Visible=false;detailLabel.Visible=false;collapseButton.Visible=false;
      header.Dock=DockStyle.Fill;header.Height=LauncherSize;avatar.Location=new Point(5,5);avatar.Size=new Size(72,72);
      Size=new Size(LauncherSize,LauncherSize);ApplyRoundedRegion();EnsureVisibleOnScreen();
    }

    public void Expand(){
      if(!collapsed)return;collapsed=false;MarkActive();
      Size=new Size(ExpandedWidth,ExpandedHeight);header.Dock=DockStyle.Top;header.Height=112;
      avatar.Location=new Point(18,16);avatar.Size=new Size(72,72);
      contentPanel.Visible=true;title.Visible=true;stateLabel.Visible=true;detailLabel.Visible=true;collapseButton.Visible=true;
      ApplyRoundedRegion();EnsureVisibleOnScreen();
    }

    void MarkActive(){lastActive=DateTime.UtcNow;}

    void DragStart(object sender,MouseEventArgs e){if(e.Button!=MouseButtons.Left)return;dragging=true;dragOrigin=Cursor.Position;windowOrigin=Location;MarkActive();}
    void DragMove(object sender,MouseEventArgs e){if(!dragging)return;Point now=Cursor.Position;Location=new Point(windowOrigin.X+(now.X-dragOrigin.X),windowOrigin.Y+(now.Y-dragOrigin.Y));}
    void DragEnd(object sender,MouseEventArgs e){if(!dragging)return;dragging=false;EnsureVisibleOnScreen();SavePosition();}

    void RestorePosition(){
      try{
        string file=Path.Combine(root,".local","native","panel-position.json");
        if(File.Exists(file)){
          var value=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(file));
          Location=new Point(Convert.ToInt32(value["x"]),Convert.ToInt32(value["y"]));
        }else{
          Rectangle area=Screen.PrimaryScreen.WorkingArea;Location=new Point(area.Right-ExpandedWidth-24,area.Bottom-ExpandedHeight-24);
        }
      }catch{
        Rectangle area=Screen.PrimaryScreen.WorkingArea;Location=new Point(area.Right-ExpandedWidth-24,area.Bottom-ExpandedHeight-24);
      }
      EnsureVisibleOnScreen();
    }

    void SavePosition(){
      try{
        string file=Path.Combine(root,".local","native","panel-position.json");
        File.WriteAllText(file,json.Serialize(new {x=Left,y=Top,collapsed=collapsed}),new UTF8Encoding(false));
      }catch{}
    }

    void EnsureVisibleOnScreen(){
      Screen screen=Screen.FromPoint(new Point(Left+Math.Max(1,Width/2),Top+Math.Max(1,Height/2)));
      Rectangle area=screen.WorkingArea;
      int x=Math.Min(Math.Max(Left,area.Left),Math.Max(area.Left,area.Right-Width));
      int y=Math.Min(Math.Max(Top,area.Top),Math.Max(area.Top,area.Bottom-Height));
      Location=new Point(x,y);
    }

    void ApplyRoundedRegion(){
      int radius=collapsed?28:20;Rectangle r=new Rectangle(0,0,Width,Height);
      using(var path=new GraphicsPath()){
        path.AddArc(r.Left,r.Top,radius,radius,180,90);path.AddArc(r.Right-radius,r.Top,radius,radius,270,90);
        path.AddArc(r.Right-radius,r.Bottom-radius,radius,radius,0,90);path.AddArc(r.Left,r.Bottom-radius,radius,radius,90,90);path.CloseFigure();
        Region old=Region;Region=new Region(path);if(old!=null)old.Dispose();
      }
    }

    sealed class RobotAvatar : Control {
      readonly Timer timer=new Timer();readonly bool motionAllowed=ClientAnimationEnabled();string state="Idle";int frame;public event EventHandler LauncherClicked;
      [System.Runtime.InteropServices.DllImport("user32.dll")]static extern bool SystemParametersInfo(uint action,uint parameter,ref bool value,uint flags);
      static bool ClientAnimationEnabled(){bool enabled=true;try{SystemParametersInfo(0x1042,0,ref enabled,0);}catch{}return enabled;}
      public RobotAvatar(){
        SetStyle(ControlStyles.AllPaintingInWmPaint|ControlStyles.OptimizedDoubleBuffer|ControlStyles.UserPaint,true);
        Cursor=Cursors.Hand;timer.Interval=180;timer.Tick+=delegate{if(motionAllowed){frame=(frame+1)%8;Invalidate();}};timer.Start();
        Click+=delegate{if(LauncherClicked!=null)LauncherClicked(this,EventArgs.Empty);};
      }
      public void SetState(string value){state=value??"Idle";Invalidate();}
      protected override void OnPaint(PaintEventArgs e){
        base.OnPaint(e);e.Graphics.SmoothingMode=SmoothingMode.AntiAlias;RectangleF box=new RectangleF(8,12,Width-16,Height-22);
        Color accent=state=="Error"?Color.FromArgb(235,74,96):state=="Offline"?Color.FromArgb(145,132,143):Color.FromArgb(255,72,135);
        using(var glow=new SolidBrush(Color.FromArgb(22+(frame%3)*8,accent)))e.Graphics.FillEllipse(glow,1,5,Width-2,Height-8);
        using(var body=new SolidBrush(Color.FromArgb(54,45,59)))RoundRect(e.Graphics,body,box,18);
        using(var border=new Pen(Color.FromArgb(185,accent),2))e.Graphics.DrawArc(border,box.X,box.Y,box.Width,box.Height,0,360);
        float eyeY=box.Y+box.Height*.42f,eyeShift=(state=="Speaking"||state=="Working")?(frame%2):0;
        using(var eyes=new SolidBrush(accent)){e.Graphics.FillEllipse(eyes,box.X+box.Width*.27f,eyeY+eyeShift,8,8);e.Graphics.FillEllipse(eyes,box.X+box.Width*.63f,eyeY+eyeShift,8,8);}
        using(var mouth=new Pen(Color.FromArgb(210,230,214,224),2))e.Graphics.DrawArc(mouth,box.X+box.Width*.34f,box.Y+box.Height*.56f,box.Width*.32f,box.Height*.18f,5,170);
      }
      static void RoundRect(Graphics g,Brush brush,RectangleF r,float radius){
        using(var p=new GraphicsPath()){p.AddArc(r.X,r.Y,radius,radius,180,90);p.AddArc(r.Right-radius,r.Y,radius,radius,270,90);p.AddArc(r.Right-radius,r.Bottom-radius,radius,radius,0,90);p.AddArc(r.X,r.Bottom-radius,radius,radius,90,90);p.CloseFigure();g.FillPath(brush,p);}
      }
    }

    sealed class Waveform : Control {
      double level;string state="Idle";
      public Waveform(){SetStyle(ControlStyles.AllPaintingInWmPaint|ControlStyles.OptimizedDoubleBuffer|ControlStyles.UserPaint,true);}
      public void SetLevel(double value,string current){level=Math.Max(0,Math.Min(1,value/650.0));state=current??"Idle";Invalidate();}
      protected override void OnPaint(PaintEventArgs e){
        base.OnPaint(e);e.Graphics.SmoothingMode=SmoothingMode.AntiAlias;int bars=24;float gap=4f;float width=(Width-gap*(bars-1))/bars;
        Color active=(state=="Error"||state=="Offline")?Color.FromArgb(139,94,110):Color.FromArgb(255,75,137);
        for(int i=0;i<bars;i++){double wave=.18+Math.Abs(Math.Sin((i+1)*.74))*level*.82;float h=(float)Math.Max(4,wave*(Height-12));float x=i*(width+gap),y=(Height-h)/2;using(var b=new SolidBrush(Color.FromArgb(90+(int)(120*level),active)))e.Graphics.FillRectangle(b,x,y,width,h);}
      }
    }
  }
}
