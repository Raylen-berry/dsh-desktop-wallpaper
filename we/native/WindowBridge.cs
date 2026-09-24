using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using System.Threading;

// A stdin-only window companion. Align WE with DSH so WE reads the real cursor.
// No input injection, system cursor changes, clicks, or keyboard forwarding.
class WindowBridge {
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] struct Point { public int X,Y; }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr FindWindow(string cls,string title);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h,out Rect r);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out Rect r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h,ref Point p);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int ht,uint flags);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h,uint msg,IntPtr wp,IntPtr lp);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h,int command);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h,uint command);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,StringBuilder text,int max);
  static readonly object Gate=new object();
  static readonly JavaScriptSerializer Json=new JavaScriptSerializer();
  static IntPtr target,owner;
  static string title,executable;
  static int parent;
  static uint verifiedPid;
  static bool hidden;
  static bool ValidTarget() {
    if(target==IntPtr.Zero || !IsWindow(target))return false;
    var text=new StringBuilder(256);GetWindowText(target,text,256);
    if(text.ToString()!=title)return false;
    uint pid;GetWindowThreadProcessId(target,out pid);
    if(verifiedPid!=0)return pid==verifiedPid;
    try{using(var process=Process.GetProcessById((int)pid)){
      if(!String.Equals(process.MainModule.FileName,executable,StringComparison.OrdinalIgnoreCase))return false;
      verifiedPid=pid;return true;
    }}catch{return false;}
  }
  static bool ValidOwner() { uint pid;GetWindowThreadProcessId(owner,out pid);return IsWindow(owner)&&pid==(uint)parent; }
  static void Close(){if(ValidTarget())PostMessage(target,0x0010,IntPtr.Zero,IntPtr.Zero);}
  static void Reply(object value){Console.WriteLine(Json.Serialize(value));Console.Out.Flush();}
  static object Geometry(){
    Rect c,w;GetClientRect(target,out c);GetWindowRect(target,out w);var o=new Point();ClientToScreen(target,ref o);
    return new {ok=true,handle=target.ToInt64(),width=c.Right,height=c.Bottom,outerWidth=w.Right-w.Left,outerHeight=w.Bottom-w.Top,left=o.X-w.Left,top=o.Y-w.Top,hidden=hidden};
  }
  static void Follow(){
    if(!ValidOwner()||!ValidTarget()){Close();Environment.Exit(0);return;}
    if(IsIconic(owner)||!IsWindowVisible(owner)){if(!hidden){ShowWindow(target,0);hidden=true;}return;}
    if(hidden){ShowWindow(target,4);hidden=false;}
    Rect r,tc,tw;GetClientRect(owner,out r);GetClientRect(target,out tc);GetWindowRect(target,out tw);
    var p=new Point();ClientToScreen(owner,ref p);var t=new Point();ClientToScreen(target,ref t);
    int x=p.X-(t.X-tw.Left),y=p.Y-(t.Y-tw.Top);
    int w=r.Right+(tw.Right-tw.Left-tc.Right),h=r.Bottom+(tw.Bottom-tw.Top-tc.Bottom);
    if(w<1||h<1)return;
    // Place immediately below DSH, with no activation. Other apps stay above both.
    bool move=tw.Left!=x||tw.Top!=y,size=tw.Right-tw.Left!=w||tw.Bottom-tw.Top!=h;
    if(move||size||GetWindow(target,3)!=owner)
      // Z-order alone must not tell the renderer to resize its swap chain.
      SetWindowPos(target,owner,x,y,w,h,(uint)(0x0010|(move?0:0x0002)|(size?0:0x0001)));
  }
  static void Main(string[] args){
    if(args.Length!=4||!args[0].StartsWith("DSH-WE-"))return;
    try{SetProcessDpiAwarenessContext(new IntPtr(-4));}catch{}
    title=args[0];executable=System.IO.Path.GetFullPath(args[1]);parent=Int32.Parse(args[2]);owner=new IntPtr(Int64.Parse(args[3]));
    Timer timer=null;
    try{
      target=FindWindow(null,title);
      if(!ValidTarget()||!ValidOwner())throw new Exception("WE/DSH window identity check failed");
      Follow();
      timer=new Timer(_=>{lock(Gate){Follow();}},null,33,33);
      string line;while((line=Console.ReadLine())!=null){lock(Gate){
        if(line.Length>256)throw new Exception("request too large");
        if(line=="{\"op\":\"close\"}"){Close();break;}
        if(line!="{\"op\":\"status\"}")throw new Exception("unsupported operation");
        if(!ValidTarget())throw new Exception("WE window closed");Reply(Geometry());
      }}
    }catch(Exception e){Reply(new{ok=false,error=e.Message});}
    finally{if(timer!=null)timer.Dispose();Close();}
  }
}
