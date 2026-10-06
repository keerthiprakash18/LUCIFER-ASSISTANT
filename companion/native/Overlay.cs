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
    readonly WakeHero wakeHero=new WakeHero();
    readonly Timer idleTimer=new Timer();
    readonly Timer wakeTimer=new Timer();
    bool collapsed;
    bool wakeScene;
    DateTime wakeSceneAt=DateTime.MinValue;
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

      Paint+=delegate(object sender,PaintEventArgs e){Color edge=wakeScene?Color.FromArgb(110,68,190,255):Color.FromArgb(78,255,73,132);using(var pen=new Pen(edge,1))e.Graphics.DrawRectangle(pen,0,0,Width-1,Height-1);};
      Resize+=delegate{ApplyRoundedRegion();};
      FormClosing+=delegate(object sender,FormClosingEventArgs e){if(e.CloseReason==CloseReason.UserClosing){e.Cancel=true;Collapse();}};
      Deactivate+=delegate{if(currentState=="Idle")MarkActive();};

      wakeHero.Dock=DockStyle.Fill;wakeHero.Visible=false;wakeHero.BackColor=Color.Transparent;Controls.Add(wakeHero);wakeHero.BringToFront();
      wakeTimer.Interval=33;wakeTimer.Tick+=delegate{
        if(!wakeScene)return;
        wakeHero.Advance();
        if((currentState=="Working"||currentState=="Understanding")&&(DateTime.UtcNow-wakeSceneAt).TotalMilliseconds>520)ShowTaskPanel();
      };wakeTimer.Start();

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

    public void ShowWakeScene(){
      MarkActive();wakeScene=true;wakeSceneAt=DateTime.UtcNow;collapsed=false;
      Size=new Size(520,340);header.Visible=false;contentPanel.Visible=false;wakeHero.Visible=true;wakeHero.SetState(currentState);
      wakeHero.BringToFront();Rectangle area=Screen.FromPoint(Cursor.Position).WorkingArea;Location=new Point(area.Left+(area.Width-Width)/2,area.Top+Math.Max(48,(area.Height-Height)/2-30));EnsureVisibleOnScreen();
      Opacity=0.0;if(!Visible)Show();
      var fade=new Timer();fade.Interval=16;fade.Tick+=delegate{if(IsDisposed){fade.Stop();fade.Dispose();return;}Opacity=Math.Min(.985,Opacity+.085);if(Opacity>=.985){fade.Stop();fade.Dispose();}};fade.Start();
      Invalidate();
    }

    void ShowTaskPanel(){
      if(!wakeScene)return;wakeScene=false;wakeHero.Visible=false;header.Visible=true;contentPanel.Visible=true;
      Size=new Size(ExpandedWidth,ExpandedHeight);header.Dock=DockStyle.Top;header.Height=112;
      avatar.Location=new Point(18,16);avatar.Size=new Size(72,72);title.Visible=true;stateLabel.Visible=true;detailLabel.Visible=true;collapseButton.Visible=true;
      EnsureVisibleOnScreen();ApplyRoundedRegion();Invalidate();
    }

    public void ShowPassive(){
      MarkActive();
      if(wakeScene)ShowTaskPanel();
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
      avatar.SetState(currentState);waveform.SetLevel(level,currentState);wakeHero.SetState(currentState,detail,level);
      if(currentState!="Idle")MarkActive();
    }

    public void SetSummonShortcut(bool available,bool shiftFallback){shortcutLabel.Text=available?(shiftFallback?"Ctrl+Alt+Shift+Space summons · Ctrl+Alt+Esc stops":"Ctrl+Alt+Space summons · Ctrl+Alt+Esc stops"):"Summon shortcut unavailable · use tray/Talk · Ctrl+Alt+Esc stops";}
    public void SetResult(string text){if(!String.IsNullOrWhiteSpace(text))resultLabel.Text=text;MarkActive();}
    public void SetTranscript(string text){if(!String.IsNullOrWhiteSpace(text))transcriptLabel.Text=text;MarkActive();}

    public void Collapse(){
      if(collapsed)return;wakeScene=false;wakeHero.Visible=false;header.Visible=true;collapsed=true;MarkActive();SavePosition();
      contentPanel.Visible=false;title.Visible=false;stateLabel.Visible=false;detailLabel.Visible=false;collapseButton.Visible=false;
      header.Dock=DockStyle.Fill;header.Height=LauncherSize;avatar.Location=new Point(5,5);avatar.Size=new Size(72,72);
      Size=new Size(LauncherSize,LauncherSize);ApplyRoundedRegion();EnsureVisibleOnScreen();
    }

    public void Expand(){
      if(!collapsed)return;wakeScene=false;wakeHero.Visible=false;header.Visible=true;collapsed=false;MarkActive();
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

    sealed class WakeHero : Control {
      readonly bool motionAllowed=RobotAvatar.ClientAnimationEnabled();int frame;string state="Listening",detail="Local wake ready";double level;
      public WakeHero(){SetStyle(ControlStyles.AllPaintingInWmPaint|ControlStyles.OptimizedDoubleBuffer|ControlStyles.UserPaint|ControlStyles.SupportsTransparentBackColor,true);}
      public void Advance(){if(motionAllowed)frame=(frame+1)%240;Invalidate();}
      public void SetState(string current){state=String.IsNullOrWhiteSpace(current)?"Listening":current;Invalidate();}
      public void SetState(string current,string text,double audio){state=String.IsNullOrWhiteSpace(current)?"Listening":current;detail=String.IsNullOrWhiteSpace(text)?"Ready":text;level=Math.Max(0,Math.Min(1,audio/650.0));Invalidate();}
      protected override void OnPaint(PaintEventArgs e){
        base.OnPaint(e);e.Graphics.SmoothingMode=SmoothingMode.AntiAlias;
        Rectangle r=ClientRectangle;if(r.Width<10||r.Height<10)return;
        using(var bg=new LinearGradientBrush(r,Color.FromArgb(6,18,28),Color.FromArgb(12,42,67),18f))e.Graphics.FillRectangle(bg,r);
        using(var vignette=new SolidBrush(Color.FromArgb(80,2,9,15))){e.Graphics.FillRectangle(vignette,0,0,r.Width,34);e.Graphics.FillRectangle(vignette,0,r.Height-42,r.Width,42);}
        int cx=r.Width/2,cy=142;float pulse=motionAllowed?(float)(.5+.5*Math.Sin(frame*.12)):.5f;
        for(int i=0;i<3;i++){float radius=58+i*24+pulse*5;int alpha=52-i*12;using(var ring=new Pen(Color.FromArgb(alpha,55,180,255),i==0?2f:1f))e.Graphics.DrawEllipse(ring,cx-radius,cy-radius,radius*2,radius*2);}
        for(int i=0;i<12;i++){double angle=(frame*.018+i*Math.PI*2/12);float radius=92+(i%3)*5;float x=cx+(float)Math.Cos(angle)*radius,y=cy+(float)Math.Sin(angle)*radius;using(var dot=new SolidBrush(Color.FromArgb(70+(i%4)*22,66,190,255)))e.Graphics.FillEllipse(dot,x-2,y-2,4,4);}
        using(var coreGlow=new SolidBrush(Color.FromArgb(30+(int)(35*pulse),45,178,255)))e.Graphics.FillEllipse(coreGlow,cx-64,cy-64,128,128);
        RectangleF head=new RectangleF(cx-48,cy-40,96,80);
        using(var body=new LinearGradientBrush(head,Color.FromArgb(27,51,70),Color.FromArgb(13,28,42),90f))RoundRect(e.Graphics,body,head,28);
        using(var border=new Pen(Color.FromArgb(205,72,196,255),2))RoundRectStroke(e.Graphics,border,head,28);
        float scan=state=="Understanding"||state=="Working"?(motionAllowed?(frame%24-12)*.55f:0):0;
        using(var eye=new SolidBrush(Color.FromArgb(245,91,211,255))){e.Graphics.FillEllipse(eye,cx-27+scan,cy-8,12,12);e.Graphics.FillEllipse(eye,cx+15+scan,cy-8,12,12);}
        using(var mouth=new Pen(Color.FromArgb(220,185,234,255),2)){
          if(state=="Speaking"){float h=8+(motionAllowed?(frame%5)*2:4);e.Graphics.DrawEllipse(mouth,cx-12,cy+16,24,h);}
          else e.Graphics.DrawArc(mouth,cx-15,cy+12,30,18,5,170);
        }
        int barY=235;for(int i=0;i<34;i++){double wave=.18+Math.Abs(Math.Sin(i*.61+frame*.09))*(state=="Listening"?(.22+level*.78):.32);float h=(float)(4+wave*18);float x=cx-136+i*8;using(var b=new SolidBrush(Color.FromArgb(80+(int)(110*wave),57,177,241)))e.Graphics.FillRectangle(b,x,barY-h/2,3,h);}
        using(var labelFont=new Font("Segoe UI Semibold",8,FontStyle.Bold))using(var labelBrush=new SolidBrush(Color.FromArgb(128,165,199,220)))e.Graphics.DrawString("PERSONAL INTELLIGENCE  •  SECURE LOCAL WAKE",labelFont,labelBrush,24,22);
        string headline=state=="Speaking"?"YES BOSS":state=="Working"?"WORKING":state=="Understanding"?"UNDERSTANDING":"LUCIFER";
        using(var font=new Font("Segoe UI Semibold",22,FontStyle.Bold))using(var brush=new SolidBrush(Color.FromArgb(245,244,250,255))){var size=e.Graphics.MeasureString(headline,font);e.Graphics.DrawString(headline,font,brush,cx-size.Width/2,270);}
        string sub=state=="Listening"?"Listening for your command":state=="Speaking"?"Wake confirmed":detail;
        if(sub.Length>54)sub=sub.Substring(0,54)+"…";
        using(var font=new Font("Segoe UI",9))using(var brush=new SolidBrush(Color.FromArgb(165,175,202,220))){var size=e.Graphics.MeasureString(sub,font);e.Graphics.DrawString(sub,font,brush,cx-size.Width/2,307);}
        int scanX=motionAllowed?(frame*7)%Math.Max(1,r.Width):r.Width/2;using(var scanPen=new Pen(Color.FromArgb(22,66,193,255),1))e.Graphics.DrawLine(scanPen,scanX,44,scanX,r.Height-48);
      }
      static void RoundRect(Graphics g,Brush brush,RectangleF r,float radius){using(var p=Path(r,radius))g.FillPath(brush,p);}
      static void RoundRectStroke(Graphics g,Pen pen,RectangleF r,float radius){using(var p=Path(r,radius))g.DrawPath(pen,p);}
      static GraphicsPath Path(RectangleF r,float radius){var p=new GraphicsPath();p.AddArc(r.X,r.Y,radius,radius,180,90);p.AddArc(r.Right-radius,r.Y,radius,radius,270,90);p.AddArc(r.Right-radius,r.Bottom-radius,radius,radius,0,90);p.AddArc(r.X,r.Bottom-radius,radius,radius,90,90);p.CloseFigure();return p;}
    }

    sealed class RobotAvatar : Control {
      readonly Timer timer=new Timer();readonly bool motionAllowed=ClientAnimationEnabled();string state="Idle";int frame;public event EventHandler LauncherClicked;
      [System.Runtime.InteropServices.DllImport("user32.dll")]static extern bool SystemParametersInfo(uint action,uint parameter,ref bool value,uint flags);
      public static bool ClientAnimationEnabled(){bool enabled=true;try{SystemParametersInfo(0x1042,0,ref enabled,0);}catch{}return enabled;}
      public RobotAvatar(){
        SetStyle(ControlStyles.AllPaintingInWmPaint|ControlStyles.OptimizedDoubleBuffer|ControlStyles.UserPaint,true);
        Cursor=Cursors.Hand;timer.Interval=180;timer.Tick+=delegate{if(motionAllowed){frame=(frame+1)%8;Invalidate();}};timer.Start();
        Click+=delegate{if(LauncherClicked!=null)LauncherClicked(this,EventArgs.Empty);};
      }
      public void SetState(string value){state=value??"Idle";Invalidate();}
      protected override void OnPaint(PaintEventArgs e){
        base.OnPaint(e);e.Graphics.SmoothingMode=SmoothingMode.AntiAlias;
        bool listening=state=="Listening",thinking=state=="Understanding"||state=="Working",talking=state=="Speaking";
        float bob=motionAllowed?(float)Math.Sin(frame*.9)*1.4f:0f;
        RectangleF box=new RectangleF(8,12+bob,Width-16,Height-22);
        Color accent=state=="Error"?Color.FromArgb(235,74,96):state=="Offline"?Color.FromArgb(145,132,143):Color.FromArgb(255,72,135);
        int pulse=motionAllowed?(frame%4)*8:12;
        using(var outer=new Pen(Color.FromArgb(34+pulse,accent),2))e.Graphics.DrawEllipse(outer,2,6,Width-4,Height-10);
        if(listening||thinking||talking){using(var halo=new Pen(Color.FromArgb(22+pulse/2,accent),1))e.Graphics.DrawEllipse(halo,0,3,Width,Height-4);}
        using(var glow=new SolidBrush(Color.FromArgb(22+pulse,accent)))e.Graphics.FillEllipse(glow,3,7,Width-6,Height-10);
        using(var body=new SolidBrush(Color.FromArgb(54,45,59)))RoundRect(e.Graphics,body,box,18);
        using(var border=new Pen(Color.FromArgb(205,accent),2))e.Graphics.DrawArc(border,box.X,box.Y,box.Width,box.Height,0,360);
        float antennaX=box.X+box.Width*.5f,antennaY=box.Y-3;
        using(var antenna=new Pen(Color.FromArgb(180,accent),2)){e.Graphics.DrawLine(antenna,antennaX,antennaY,antennaX,box.Y+4);e.Graphics.DrawEllipse(antenna,antennaX-2,antennaY-4,4,4);}
        float eyeY=box.Y+box.Height*.41f;
        float scan=thinking&&motionAllowed?(frame%5-2)*1.5f:0f;
        bool blink=motionAllowed&&frame==7&&!talking;
        using(var eyes=new SolidBrush(accent)){
          if(blink){e.Graphics.FillRectangle(eyes,box.X+box.Width*.27f,eyeY+4,9,2);e.Graphics.FillRectangle(eyes,box.X+box.Width*.63f,eyeY+4,9,2);}
          else{e.Graphics.FillEllipse(eyes,box.X+box.Width*.27f+scan,eyeY,9,9);e.Graphics.FillEllipse(eyes,box.X+box.Width*.63f+scan,eyeY,9,9);}
        }
        using(var cheek=new SolidBrush(Color.FromArgb(listening?85:35,accent))){e.Graphics.FillEllipse(cheek,box.X+box.Width*.18f,box.Y+box.Height*.56f,7,4);e.Graphics.FillEllipse(cheek,box.X+box.Width*.73f,box.Y+box.Height*.56f,7,4);}
        using(var mouth=new Pen(Color.FromArgb(225,235,218,229),2)){
          if(talking&&motionAllowed){float h=6+(frame%4)*2;e.Graphics.DrawEllipse(mouth,box.X+box.Width*.39f,box.Y+box.Height*.60f,box.Width*.22f,h);}
          else if(thinking)e.Graphics.DrawLine(mouth,box.X+box.Width*.39f,box.Y+box.Height*.65f,box.X+box.Width*.61f,box.Y+box.Height*.65f);
          else e.Graphics.DrawArc(mouth,box.X+box.Width*.34f,box.Y+box.Height*.56f,box.Width*.32f,box.Height*.18f,5,170);
        }
        if(listening){using(var ear=new Pen(Color.FromArgb(150,accent),2)){e.Graphics.DrawArc(ear,box.X-3,box.Y+box.Height*.31f,10,18,80,200);e.Graphics.DrawArc(ear,box.Right-7,box.Y+box.Height*.31f,10,18,260,200);}}
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
