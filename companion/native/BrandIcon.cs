using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

namespace LuciferNative {
  static class BrandIcon {
    [DllImport("user32.dll")]static extern bool DestroyIcon(IntPtr icon);
    static Bitmap Draw(int size,string status){
      var bitmap=new Bitmap(size,size,PixelFormat.Format32bppArgb);
      using(var graphics=Graphics.FromImage(bitmap)){
        graphics.SmoothingMode=SmoothingMode.AntiAlias;graphics.ScaleTransform(size/128f,size/128f);
        using(var shape=new GraphicsPath())using(var background=new SolidBrush(Color.FromArgb(168,36,72))){
          shape.AddArc(0,0,70,70,180,90);shape.AddArc(58,0,70,70,270,90);shape.AddArc(58,58,70,70,0,90);shape.AddArc(0,58,70,70,90,90);shape.CloseFigure();graphics.FillPath(background,shape);
        }
        using(var pen=new Pen(Color.White,6){LineJoin=LineJoin.Round,StartCap=LineCap.Round,EndCap=LineCap.Round}){
          graphics.DrawPolygon(pen,new[]{new PointF(32,28),new PointF(64,46),new PointF(96,28),new PointF(84,69),new PointF(64,102),new PointF(44,69)});
          graphics.DrawLines(pen,new[]{new PointF(48,54),new PointF(64,67),new PointF(80,54)});graphics.DrawLine(pen,64,67,64,86);
        }
        if(status!="Brand")using(var dot=new SolidBrush(status=="Error"?Color.FromArgb(244,90,100):status=="Paused"?Color.FromArgb(255,201,88):status=="Working"?Color.FromArgb(100,182,255):Color.FromArgb(86,225,146)))using(var border=new Pen(Color.White,3)){graphics.FillEllipse(dot,94,94,28,28);graphics.DrawEllipse(border,94,94,28,28);}
      }
      return bitmap;
    }
    public static Icon Create(string status){using(var bitmap=Draw(32,status)){IntPtr handle=bitmap.GetHicon();try{using(var borrowed=Icon.FromHandle(handle))return (Icon)borrowed.Clone();}finally{DestroyIcon(handle);}}}
    public static void Export(string path){
      int[] sizes={16,24,32,48,64,128};byte[][] images=new byte[sizes.Length][];
      for(int index=0;index<sizes.Length;index++)using(var bitmap=Draw(sizes[index],"Brand"))using(var buffer=new MemoryStream()){bitmap.Save(buffer,ImageFormat.Png);images[index]=buffer.ToArray();}
      using(var writer=new BinaryWriter(File.Create(path))){writer.Write((ushort)0);writer.Write((ushort)1);writer.Write((ushort)sizes.Length);uint offset=(uint)(6+16*sizes.Length);for(int index=0;index<sizes.Length;index++){writer.Write((byte)sizes[index]);writer.Write((byte)sizes[index]);writer.Write((byte)0);writer.Write((byte)0);writer.Write((ushort)1);writer.Write((ushort)32);writer.Write((uint)images[index].Length);writer.Write(offset);offset+=(uint)images[index].Length;}foreach(var image in images)writer.Write(image);}
    }
  }
  static class IconBuilder {static void Main(string[] args){BrandIcon.Export(Path.GetFullPath(args[0]));}}
}
