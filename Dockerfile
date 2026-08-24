FROM node:20-alpine

LABEL maintainer="xiakeman" description="xiakeman runtime deployment"

RUN apk add --no-cache nginx curl ffmpeg

COPY nginx.conf /etc/nginx/http.d/default.conf
COPY dist /usr/share/nginx/html
RUN chmod -R 755 /usr/share/nginx/html

COPY bff/package*.json /opt/xiakeman-bff/
RUN cd /opt/xiakeman-bff && npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY bff /opt/xiakeman-bff
COPY start.sh /start.sh
RUN chmod +x /start.sh

VOLUME ["/data"]

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD curl -f http://127.0.0.1:8030/api/health || exit 1

CMD ["/start.sh"]
