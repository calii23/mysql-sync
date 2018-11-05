FROM node
RUN mkdir /app
WORKDIR /app
ADD package.json /app
RUN npm i --production
ADD dist /app
VOLUME /etc/mysql-sync
ENTRYPOINT ["/usr/local/bin/node", "/app/application.js", "/etc/mysql-sync/config.json"]