using System;
using System.Threading.Tasks;
using Velopack;
using Velopack.Sources;

namespace AccountSwitch.Desktop
{
    /// <summary>
    /// Self-update (Velopack): check, download in the background, then apply on restart or at exit.
    /// Feed: GitHub Releases of the public repository, or a folder/URL override for testing.
    /// </summary>
    internal sealed class Updater
    {
        public const string ReleaseRepository = "https://github.com/hongikarchi/AccountSwitch";
        private readonly UpdateManager manager;
        private UpdateInfo pending;
        private Task running;
        public string State { get; private set; } = "idle";
        public string Available { get; private set; }
        public string Error { get; private set; }
        public DateTime? CheckedAt { get; private set; }
        public event Action Changed;

        public Updater(string source)
        {
            try
            {
                manager = string.IsNullOrWhiteSpace(source)
                    ? new UpdateManager(new GithubSource(ReleaseRepository, null, false))
                    : new UpdateManager(source.Trim());
                // A build run outside an installation cannot update itself.
                if (!manager.IsInstalled) State = "unavailable";
                else if (manager.UpdatePendingRestart is VelopackAsset ready)
                {
                    State = "ready";
                    Available = ready.Version.ToString();
                }
            }
            catch (Exception error)
            {
                State = "unavailable";
                Error = error.Message;
            }
        }

        public Task Check()
        {
            if (manager == null || State == "unavailable" || State == "ready") return Task.CompletedTask;
            if (running != null && !running.IsCompleted) return running;
            return running = Run();
        }

        private async Task Run()
        {
            Set("checking");
            try
            {
                var info = await manager.CheckForUpdatesAsync().ConfigureAwait(false);
                CheckedAt = DateTime.Now;
                if (info == null)
                {
                    Set("current");
                    return;
                }
                Available = info.TargetFullRelease.Version.ToString();
                Set("downloading");
                await manager.DownloadUpdatesAsync(info).ConfigureAwait(false);
                pending = info;
                Set("ready");
            }
            catch (Exception error)
            {
                Error = error.Message;
                Set("error");
            }
        }

        /// <summary>Replace the program now and start the new version (the caller stops the server first).</summary>
        public void ApplyAndRestart()
        {
            var asset = pending?.TargetFullRelease ?? manager?.UpdatePendingRestart;
            if (asset != null) manager.ApplyUpdatesAndRestart(asset);
        }

        /// <summary>At exit: apply a downloaded update after this process ends, without restarting.</summary>
        public void ApplyAtExit()
        {
            var asset = pending?.TargetFullRelease ?? manager?.UpdatePendingRestart;
            if (asset != null) manager.WaitExitThenApplyUpdates(asset, true, false);
        }

        private void Set(string state)
        {
            State = state;
            if (state != "error") Error = null;
            Changed?.Invoke();
        }
    }
}
