using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace LuciferNative {
  public sealed class PcmStream : Stream {
    readonly Queue<byte[]> queue=new Queue<byte[]>(); readonly AutoResetEvent available=new AutoResetEvent(false);
    byte[] current; int offset; bool closed;
    public void Push(byte[] data){lock(queue){if(closed)return;while(queue.Count>30)queue.Dequeue();queue.Enqueue(data);}available.Set();}
    public override int Read(byte[] buffer,int start,int count){while(!closed){lock(queue){if(current==null&&queue.Count>0){current=queue.Dequeue();offset=0;}if(current!=null){int size=Math.Min(count,current.Length-offset);Buffer.BlockCopy(current,offset,buffer,start,size);offset+=size;if(offset==current.Length)current=null;return size;}}available.WaitOne(500);}return 0;}
    protected override void Dispose(bool disposing){closed=true;available.Set();base.Dispose(disposing);}
    public override bool CanRead{get{return true;}}public override bool CanSeek{get{return false;}}public override bool CanWrite{get{return false;}}
    public override long Length{get{return Int64.MaxValue;}}public override long Position{get{return 0;}set{}}
    public override void Flush(){}public override long Seek(long o,SeekOrigin s){return 0;}public override void SetLength(long l){throw new NotSupportedException();}public override void Write(byte[] b,int o,int c){throw new NotSupportedException();}
  }
  public sealed class AudioInput : IDisposable {
    [StructLayout(LayoutKind.Sequential)]struct Format{public ushort tag,channels;public uint rate,bytes;public ushort align,bits,extra;}
    [StructLayout(LayoutKind.Sequential)]struct Header{public IntPtr data;public uint length,recorded;public IntPtr user;public uint flags,loops;public IntPtr next,reserved;}
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]struct Caps{public ushort mid,pid;public uint version;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)]public string name;public uint formats;public ushort channels,reserved;}
    delegate void Callback(IntPtr handle,uint message,IntPtr instance,IntPtr header,IntPtr reserved);
    [DllImport("winmm.dll")]static extern uint waveInOpen(out IntPtr handle,int device,ref Format format,Callback callback,IntPtr instance,uint flags);
    [DllImport("winmm.dll")]static extern uint waveInPrepareHeader(IntPtr handle,IntPtr header,uint size);
    [DllImport("winmm.dll")]static extern uint waveInUnprepareHeader(IntPtr handle,IntPtr header,uint size);
    [DllImport("winmm.dll")]static extern uint waveInAddBuffer(IntPtr handle,IntPtr header,uint size);
    [DllImport("winmm.dll")]static extern uint waveInStart(IntPtr handle);
    [DllImport("winmm.dll")]static extern uint waveInReset(IntPtr handle);
    [DllImport("winmm.dll")]static extern uint waveInClose(IntPtr handle);
    [DllImport("winmm.dll")]static extern uint waveInGetNumDevs();
    [DllImport("winmm.dll",CharSet=CharSet.Unicode)]static extern uint waveInGetDevCapsW(IntPtr device,out Caps caps,uint size);
    readonly List<IntPtr> headers=new List<IntPtr>();readonly List<IntPtr> buffers=new List<IntPtr>();readonly Callback callback;
    IntPtr handle;bool running;public event Action<byte[],double> Frame;
    public static string[] Devices(){var names=new List<string>();names.Add("Default Windows microphone");for(uint i=0;i<waveInGetNumDevs();i++){Caps caps;if(waveInGetDevCapsW(new IntPtr(i),out caps,(uint)Marshal.SizeOf(typeof(Caps)))==0)names.Add(caps.name);}return names.ToArray();}
    public AudioInput(int device){callback=OnData;var format=new Format{tag=1,channels=1,rate=16000,bytes=32000,align=2,bits=16,extra=0};uint result=waveInOpen(out handle,device,ref format,callback,IntPtr.Zero,0x30000);if(result!=0)throw new IOException("Microphone unavailable (Windows audio code "+result+"). Check microphone privacy permission and the selected input.");try{for(int i=0;i<4;i++){var buffer=Marshal.AllocHGlobal(3200);var pointer=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Header)));buffers.Add(buffer);headers.Add(pointer);Marshal.StructureToPtr(new Header{data=buffer,length=3200},pointer,false);waveInPrepareHeader(handle,pointer,(uint)Marshal.SizeOf(typeof(Header)));waveInAddBuffer(handle,pointer,(uint)Marshal.SizeOf(typeof(Header)));}running=true;if(waveInStart(handle)!=0)throw new IOException("Windows could not start microphone capture.");}catch{Dispose();throw;}}
    void OnData(IntPtr h,uint message,IntPtr instance,IntPtr pointer,IntPtr reserved){if(message!=0x3C0||!running)return;try{var header=(Header)Marshal.PtrToStructure(pointer,typeof(Header));if(header.recorded>0){var data=new byte[header.recorded];Marshal.Copy(header.data,data,0,data.Length);double total=0;for(int i=0;i+1<data.Length;i+=2){short sample=(short)(data[i]|data[i+1]<<8);total+=(double)sample*sample;}var listener=Frame;if(listener!=null)listener(data,Math.Sqrt(total/Math.Max(1,data.Length/2)));}if(running)waveInAddBuffer(handle,pointer,(uint)Marshal.SizeOf(typeof(Header)));}catch{}}
    public void Dispose(){running=false;if(handle!=IntPtr.Zero){waveInReset(handle);foreach(var header in headers)waveInUnprepareHeader(handle,header,(uint)Marshal.SizeOf(typeof(Header)));waveInClose(handle);handle=IntPtr.Zero;}foreach(var header in headers)Marshal.FreeHGlobal(header);foreach(var buffer in buffers)Marshal.FreeHGlobal(buffer);headers.Clear();buffers.Clear();}
    public static void SaveWav(string filename,byte[] pcm){using(var writer=new BinaryWriter(File.Create(filename))){writer.Write(System.Text.Encoding.ASCII.GetBytes("RIFF"));writer.Write(36+pcm.Length);writer.Write(System.Text.Encoding.ASCII.GetBytes("WAVEfmt "));writer.Write(16);writer.Write((short)1);writer.Write((short)1);writer.Write(16000);writer.Write(32000);writer.Write((short)2);writer.Write((short)16);writer.Write(System.Text.Encoding.ASCII.GetBytes("data"));writer.Write(pcm.Length);writer.Write(pcm);}}
  }
}
