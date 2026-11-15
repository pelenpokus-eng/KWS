# KWS helper: moves / pins another program's window (the browser window glued
# to a dock). Reads one command per line on stdin, answers one line on stdout.
#   LIST <class>                 -> hwnd<TAB>pid<TAB>title|hwnd...   (visible top-level windows)
#   PREP <hwnd> <ownerHwnd>      -> owner = KWS window (stays above it, hides with it), no frame
#   MOVE <hwnd> <x> <y> <w> <h> <top> <side> -> show only the rect x,y,w,h (physical px): the window is
#                                   made <top>/<side> px bigger and a window region cuts its own title bar / borders off
#   PLACE <hwnd> <x> <y> <w> <h> <rl> <rt> <rr> <rb> -> window rect + the part of it that stays visible
#   SHOW <hwnd> <0|1>            -> hide / show without activating
#   ALIVE <hwnd>                 -> 1 / 0
#   CLOSE <hwnd>                 -> asks the window to close
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class KwsWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint f);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] public static extern IntPtr SetWindowLongPtr(IntPtr h, int i, IntPtr v);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern int SetWindowRgn(IntPtr h, IntPtr rgn, bool redraw);
  [DllImport("gdi32.dll")] public static extern IntPtr CreateRectRgn(int l, int t, int r, int b);
  public static string List(string cls) {
    var sb = new StringBuilder();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var c = new StringBuilder(256); GetClassName(h, c, 256);
      if (c.ToString() != cls) return true;
      var t = new StringBuilder(512); GetWindowText(h, t, 512);
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (sb.Length > 0) sb.Append('|');
      sb.Append(h.ToInt64()).Append('\t').Append(pid).Append('\t').Append(t.ToString().Replace('|', ' ').Replace('\t', ' '));
      return true;
    }, IntPtr.Zero);
    return sb.ToString();
  }
}
"@
[Console]::Out.WriteLine('READY'); [Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $a = $line.Split(' ')
  $out = 'ok'
  try {
    switch ($a[0]) {
      'LIST'  { $out = [KwsWin]::List($a[1]) }
      'PREP'  {
        $h = [IntPtr][int64]$a[1]
        [void][KwsWin]::SetWindowLongPtr($h, -8, [IntPtr][int64]$a[2])          # GWLP_HWNDPARENT = owner
        $st = [KwsWin]::GetWindowLongPtr($h, -16).ToInt64()                      # GWL_STYLE
        $st = $st -band (-bnot 0x00CF0000)                                       # drop caption, borders, sysmenu
        [void][KwsWin]::SetWindowLongPtr($h, -16, [IntPtr]$st)
        [void][KwsWin]::SetWindowPos($h, [IntPtr]::Zero, 0, 0, 0, 0, 0x0037)     # FRAMECHANGED|NOMOVE|NOSIZE|NOZORDER|NOACTIVATE
      }
      'MOVE'  {
        $h = [IntPtr][int64]$a[1]; $x = [int]$a[2]; $y = [int]$a[3]; $w = [int]$a[4]; $hh = [int]$a[5]; $top = [int]$a[6]; $side = [int]$a[7]
        [void][KwsWin]::SetWindowPos($h, [IntPtr]::Zero, $x - $side, $y - $top, $w + 2 * $side, $hh + $top + $side, 0x0014)  # NOZORDER|NOACTIVATE
        [void][KwsWin]::SetWindowRgn($h, [KwsWin]::CreateRectRgn($side, $top, $side + $w, $top + $hh), $true)
      }
      'PLACE' {
        $h = [IntPtr][int64]$a[1]
        [void][KwsWin]::SetWindowPos($h, [IntPtr]::Zero, [int]$a[2], [int]$a[3], [int]$a[4], [int]$a[5], 0x0014)  # NOZORDER|NOACTIVATE
        [void][KwsWin]::SetWindowRgn($h, [KwsWin]::CreateRectRgn([int]$a[6], [int]$a[7], [int]$a[8], [int]$a[9]), $true)
      }
      'SHOW'  { [void][KwsWin]::ShowWindow([IntPtr][int64]$a[1], $(if ($a[2] -eq '1') { 8 } else { 0 })) }  # SW_SHOWNA / SW_HIDE
      'ALIVE' { $out = $(if ([KwsWin]::IsWindow([IntPtr][int64]$a[1])) { '1' } else { '0' }) }
      'CLOSE' { [void][KwsWin]::PostMessage([IntPtr][int64]$a[1], 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) }  # WM_CLOSE
      default { $out = 'unknown' }
    }
  } catch { $out = 'err ' + $_.Exception.Message.Replace("`n", ' ') }
  [Console]::Out.WriteLine($out); [Console]::Out.Flush()
}
