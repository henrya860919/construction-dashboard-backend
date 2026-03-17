# Railway 部署 mediamtx 串流服務（與 Backend 同專案、不同服務）
# 使用自訂 mediamtx.yml 啟用 Control API（9997），預設映像內 api: false 會導致 Backend 連不到
# 在 Railway 服務設定中將「對外 Port」設為 8889（WebRTC 播放用）
FROM bluenviron/mediamtx:latest

# 覆寫設定：啟用 API 9997，並允許內網呼叫（Backend 用 mediamtx.railway.internal:9997）
COPY mediamtx.yml /mediamtx.yml

EXPOSE 9997 8889 8554
