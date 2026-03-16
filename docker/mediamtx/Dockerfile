# Railway 部署 mediamtx 串流服務（與 Backend 同專案、不同服務）
# 預設：API 9997、WebRTC 8889、RTMP 1935
# 在 Railway 服務設定中將「對外 Port」設為 8889（WebRTC 播放用）
FROM bluenviron/mediamtx:latest

# 預設已啟用 api / webrtc / rtmp，無須覆寫
# 若需自訂可於 Railway Variables 設 MTX_ 開頭環境變數（見 mediamtx 文件）
EXPOSE 9997 8889 1935
