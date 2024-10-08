FROM node:16-alpine

COPY ./ /home/node

RUN apk update && \
    apk upgrade && \
    apk add --no-cache git tini bash python3 py3-pip && \
    pip install --no-cache-dir websockify

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
