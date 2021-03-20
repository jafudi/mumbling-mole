FROM alpine:20210212

COPY ./ /home/node

RUN echo http://nl.alpinelinux.org/alpine/edge/testing >> /etc/apk/repositories && \
    apk add --no-cache git nodejs npm tini websockify bash && \
    adduser -D -g 1001 -u 1001 -h /home/node node && \
    mkdir -p /home/node && \
    mkdir -p /home/node/.npm-global && \
    mkdir -p /home/node/app  && \
    chown -R node: /home/node

USER node

ENV PATH=/home/node/.npm-global/bin:/home/node:$PATH
ENV NPM_CONFIG_PREFIX=/home/node/.npm-global

RUN cd /home/node && \
    npm install && \
    npm run build

USER root

RUN apk del gcc git

USER node

EXPOSE 8081

RUN chmod +x /home/node/docker-entrypoint.sh

ENTRYPOINT ["/sbin/tini", "--", "docker-entrypoint.sh"]
