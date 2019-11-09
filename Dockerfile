# REF: https://github.com/GoogleChrome/puppeteer/blob/master/docs/troubleshooting.md
FROM node:8-slim

# See https://crbug.com/795759
RUN apt-get update && apt-get install -yq libgconf-2-4 wget \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update && apt-get install -yq google-chrome-unstable

WORKDIR /home
ADD . /home

RUN yarn install
RUN node test_1.js