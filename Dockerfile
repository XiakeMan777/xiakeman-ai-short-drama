FROM node:20-alpine

RUN apk add --no-cache nginx ffmpeg

COPY nginx.conf /etc/nginx/http.d/default.conf
COPY web /usr/share/nginx/html

WORKDIR /opt/xiakeman-bff
COPY server/server.cjs ./server.cjs
COPY voice_corpus/output ./voice_corpus/output

COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 8022 8030

CMD ["/start.sh"]
