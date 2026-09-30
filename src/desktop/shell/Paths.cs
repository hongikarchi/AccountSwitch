using System;
using System.IO;
using System.Reflection;

namespace AccountSwitch.Desktop
{
    internal static class Paths
    {
        /// <summary>Installed program folder (Velopack "current"): AccountSwitch.exe, engine\.</summary>
        public static readonly string Root = AppDomain.CurrentDomain.BaseDirectory;

        /// <summary>
        /// What Windows should start (autostart): the installation's fixed launcher stub
        /// (AccountSwitch.App\AccountSwitch.exe, stable across updates), else this executable.
        /// </summary>
        public static string Launcher
        {
            get
            {
                string current = Root.TrimEnd(Path.DirectorySeparatorChar);
                string stub = Path.Combine(Path.GetDirectoryName(current) ?? current, "AccountSwitch.exe");
                return Path.GetFileName(current).Equals("current", StringComparison.OrdinalIgnoreCase) && File.Exists(stub)
                    ? stub
                    : System.Windows.Forms.Application.ExecutablePath;
            }
        }

        /// <summary>
        /// User data, the same folder the app server uses; never touched by install, update or
        /// uninstall (the install folder is %LOCALAPPDATA%\AccountSwitch.App). After an account
        /// switch it holds the user's original CLI login.
        /// </summary>
        public static readonly string Data = Environment.GetEnvironmentVariable("ACCOUNTSWITCH_DATA") is string custom && custom.Length > 0
            ? Path.GetFullPath(custom)
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AccountSwitch");

        /// <summary>The app server: bundled engine\, or ACCOUNTSWITCH_ENGINE in development.</summary>
        public static string Engine => Environment.GetEnvironmentVariable("ACCOUNTSWITCH_ENGINE") is string engine && engine.Length > 0
            ? engine
            : Path.Combine(Root, "engine", "AccountSwitch-engine.exe");

        public static string Version
        {
            get
            {
                var info = Assembly.GetExecutingAssembly().GetCustomAttribute<AssemblyInformationalVersionAttribute>();
                string value = info?.InformationalVersion ?? "0.0.0";
                int plus = value.IndexOf('+');
                return plus >= 0 ? value.Substring(0, plus) : value;
            }
        }
    }
}
