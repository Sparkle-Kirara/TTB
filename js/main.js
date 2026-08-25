/* =====================================================================
   MAIN.JS — Platform-level initialization
   =====================================================================
   Responsible only for platform-level bootstrapping. It intentionally
   does very little: the hub view is already the active view by default
   in index.html (see <section id="hubView" class="view active">), and
   audio initialization is handled by js/shared/audio.js on its own
   DOMContentLoaded listener.

   This file exists as the designated place for any future platform-wide
   startup logic, per the project's file-separation architecture. It does
   not contain and should not contain game-specific logic — that belongs
   in js/games/*.js.
   ===================================================================== */

