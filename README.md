# TamperMonkeyScripts
Collection of various TamperMonkey scripts.  
Provided as-is, none of them are going to be maintained.

### How to install
- Install [TamperMonkey extension](https://www.tampermonkey.net/).
- For chrome: enable developer mode, allow user scripts.
- Open script's code and select "Raw".
- TM will automatically suggest to install it.

### List of scripts (for search indexing)
- [ChatGPT: Remove black background](https://github.com/Mugnum/TamperMonkeyScripts/blob/main/Scripts/chatgpt-remove-black-background.user.js)  
  Replaces pure black background on OLED screens in ChatGPT.

- [Reddit: Remove AI links](https://github.com/Mugnum/TamperMonkeyScripts/blob/main/Scripts/reddit-remove-ai-links.user.js)  
  Removes bullshit AI links from comments and reverts them to plain text.

- [Twitch: Hide controls on hotkey](https://github.com/Mugnum/TamperMonkeyScripts/blob/main/Scripts/twitch-hide-controls.user.js)  
  Hides player controls on "H" shortcut.

- [Twitch: VOD Chat Offset](https://github.com/Mugnum/TamperMonkeyScripts/blob/main/Scripts/twitch-vod-chat-offset.user.js)  
  Adjust Twitch VOD chat replay offset.
  
  Use `twitchVodChatOffset.set(-20)` in console and reload page to apply offset to current video. Will apply only to that VOD, saved value will persist across multiple VODs until another explicit `set` is called.

- [Cohh vods: Auto scroll to player](https://github.com/Mugnum/TamperMonkeyScripts/blob/main/Scripts/vods-cohh-autoscroll-to-player.user.js)  
  Scrolls video player to bottom of screen on cohhilition.com.

- [Vods: User Highlighter](https://github.com/Mugnum/TamperMonkeyScripts/blob/main/Scripts/vods-user-highlighter.user.js)  
  Highlight specific users in chat on moon2.tv and chatreplay.stream.

- [YouTube: Set high quality for embed](https://github.com/Mugnum/TamperMonkeyScripts/blob/main/Scripts/youtube-auto-quality-for-embed.user.js)  
  Makes youtube embedded videos at higher resolution.

- [YouTube: Disable Ctrl+Arrow Chapter Jump](https://github.com/Mugnum/TamperMonkeyScripts/blob/main/Scripts/youtube-remove-chapter-shortcut.user.js)  
  Removes shortcuts for jumping to next chapter on YouTube.

- [YouTube Studio: Restore Likes/Dislikes](https://github.com/Mugnum/TamperMonkeyScripts/blob/main/Scripts/youtube-studio-restore-likes-column.user.js)  
  Restores a likes/dislikes column in YouTube Studio Content.
