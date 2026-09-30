using System.IO;
using System.Web.Script.Serialization;
using Microsoft.Win32;

namespace AccountSwitch.Desktop
{
    /// <summary>desktop.json in the user data folder: autostart, background, update source, window.</summary>
    internal sealed class DesktopSettings
    {
        private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string RunValue = "AccountSwitch";
        public bool Autostart { get; set; }
        /// <summary>Closing the window keeps the program in the tray.</summary>
        public bool Background { get; set; } = true;
        public bool TrayHintShown { get; set; }
        /// <summary>Optional update feed override (folder or URL); empty uses the release feed.</summary>
        public string UpdateSource { get; set; } = "";
        public int[] Window { get; set; }
        public bool Maximized { get; set; }

        private static string File_ => Path.Combine(Paths.Data, "desktop.json");

        public static DesktopSettings Load()
        {
            try
            {
                if (File.Exists(File_))
                    return new JavaScriptSerializer().Deserialize<DesktopSettings>(File.ReadAllText(File_)) ?? new DesktopSettings();
            }
            catch
            {
                /* A damaged file falls back to defaults. */
            }
            return new DesktopSettings();
        }

        public void Save()
        {
            Directory.CreateDirectory(Paths.Data);
            string temp = File_ + ".tmp";
            File.WriteAllText(temp, new JavaScriptSerializer().Serialize(this));
            if (File.Exists(File_)) File.Replace(temp, File_, null);
            else File.Move(temp, File_);
        }

        /// <summary>Keep the Windows "Run" entry in line with the setting (current install path).</summary>
        public void ApplyAutostart(string executable)
        {
            using (var key = Registry.CurrentUser.CreateSubKey(RunKey))
            {
                if (key == null) return;
                if (Autostart) key.SetValue(RunValue, "\"" + executable + "\" --background");
                else if (key.GetValue(RunValue) != null) key.DeleteValue(RunValue, false);
            }
        }
    }
}
