using System.IO;
using System.Windows.Forms;

namespace AccountSwitch.Desktop
{
    internal enum CloseAction
    {
        /// <summary>Let the window close: the program is quitting, or Windows or code asked.</summary>
        Proceed,
        HideToTray,
        RequestQuit,
    }

    /// <summary>The decisions around quitting during an install run (SPEC 3.4), free of any window.</summary>
    internal static class QuitGuard
    {
        public const string QuitQuestion = "설치가 아직 진행 중이에요.\n지금 끝내면 설치가 중간에 멈출 수 있어요.\n\n그래도 끝낼까요?";
        public const string UpdateQuestion = "설치가 아직 진행 중이에요.\n지금 업데이트하면 설치가 중간에 멈출 수 있어요.\n\n그래도 업데이트할까요? '아니요'를 누르면 업데이트는 나중에 할 수 있어요.";

        /// <summary>The file the engine keeps while a run is active.</summary>
        public static string MarkerFile(string dataFolder) => Path.Combine(dataFolder, "setup-running");

        /// <summary>
        /// A marker alone is not enough: with no engine of ours running, quitting stops nothing. A
        /// stale marker costs one question and never blocks quitting.
        /// </summary>
        public static bool ShouldAsk(bool markerExists, bool ownEngineRunning) => markerExists && ownEngineRunning;

        /// <summary>Only the user's own close can hide the window or ask; Windows shutting down never waits.</summary>
        public static CloseAction OnClose(CloseReason reason, bool quitting, bool background)
        {
            if (reason != CloseReason.UserClosing || quitting) return CloseAction.Proceed;
            return background ? CloseAction.HideToTray : CloseAction.RequestQuit;
        }
    }
}
