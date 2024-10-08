FROM alpine:3.17

# Set up the package repositories to ensure correct versions
RUN echo "http://dl-cdn.alpinelinux.org/alpine/v3.17/main" > /etc/apk/repositories && \
    echo "http://dl-cdn.alpinelinux.org/alpine/v3.17/community" >> /etc/apk/repositories

# Install necessary packages with specific versions
RUN apk update && \
    apk upgrade && \
    apk add --no-cache git nodejs=~16 npm=~8 tini websockify bash && \
    adduser -D -g 1001 -u 1001 -h /home/node node && \
    mkdir -p /home/node && \
    mkdir -p /home/node/.npm-global && \
    mkdir -p /home/node/app  && \
    chown -R node: /home/node

USER node

ENV PATH=/home/node/.npm-global/bin:/home/node:$PATH
ENV NPM_CONFIG_PREFIX=/home/node/.npm-global

RUN cd /home/node && \
    npm run build

USER root

RUN apk del gcc git

USER node

EXPOSE 8081

RUN chmod +x /home/node/docker-entrypoint.sh

ENTRYPOINT ["/sbin/tini", "--", "docker-entrypoint.sh"]
