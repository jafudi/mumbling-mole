# Lite version of Mumble web app for all browsers

mumble-web is an HTML5 [Mumble] client that runs directly in your browser. This variant dispenses entirely of the channel view and focuses on saving UI space and performance.

## Improvements

- Reduntanize the `libsamplerate.js` package weighing about 5 MB by making use of the native resampler contained in all modern browsers anyway
- Add Support for Safari 11+

## Installing

### Download
mumble-web can either be installed directly from npm with `npm install -g mumble-web`
or from git:

```
git clone https://github.com/johni0702/mumble-web
cd mumble-web
npm install
```
Note that npm **must not** be ran as the root user (even in a container) because it will try to do special things which cause the build to fail, use a non-root user account instead.

The npm version is prebuilt and ready to use whereas the git version allows you
to e.g. customize the theme before building it.

Either way you will end up with a `dist` folder that contains the static page.

### Setup
At the time of writing this there do not seem to be any Mumble servers
which natively support Websockets. To use this client with any standard mumble
server, websockify must be set up (preferably on the same machine that the
Mumble server is running on).

You can install websockify via your package manager `apt install websockify` or
manually from the [websockify GitHub page]. Note that while some versions might
function better than others, the python version generally seems to be the best.

There are two basic ways you can use websockify with mumble-web:
- Standalone, use websockify for both, websockets and serving static files
- Proxied, let your favorite web server serve static files and proxy websocket connections to websockify

#### Standalone
This is the simplest but at the same time least flexible configuration. Replace `<mumbleserver>` with the URI of your mumble server. If `websockify` is running on the same machine as `mumble-server`, use `localhost`.
```
websockify --cert=mycert.crt --key=mykey.key --ssl-only --ssl-target --web=path/to/dist 443 <mumbleserver>:64738
```

#### Proxied
This configuration allows you to run websockify on a machine that already has
another webserver running. Replace `<mumbleserver>` with the URI of your mumble server. If `websockify` is running on the same machine as `mumble-server`, use `localhost`.

```
websockify --ssl-target 64737 <mumbleserver>:64738
```

Here are two web server configuration files (one for [NGINX](https://www.nginx.com/) and one for [Caddy server](https://caddyserver.com/)) which will serve the mumble-web interface at `https://voice.example.com` and allow the websocket to connect at `wss://voice.example.com/demo` (similar to the demo server). Replace `<websockify>` with the URI to the machine where `websockify` is running. If `websockify` is running on the same machine as your web server, use `localhost`.

* NGINX configuration file
```Nginx
server {
        listen 443 ssl;
        server_name voice.example.com;
        ssl_certificate /etc/letsencrypt/live/voice.example.com/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/voice.example.com/privkey.pem;

        location / {
                root /path/to/dist;
        }
        location /demo {
                proxy_pass http://<websockify>:64737;
                proxy_http_version 1.1;
                proxy_set_header Upgrade $http_upgrade;
                proxy_set_header Connection $connection_upgrade;
        }
}

map $http_upgrade $connection_upgrade {
        default upgrade;
        '' close;
}
```

* Caddy configuration file (`Caddyfile`)
```
http://voice.example.com {
  redir https://voice.example.com
}

https://voice.example.com {
  tls "/etc/letsencrypt/live/voice.example.com/fullchain.pem" "/etc/letsencrypt/live/voice.example.com/privkey.pem"
  root /path/to/dist
  proxy /demo http://<websockify>:64737 {
    websocket
  }
}
```

Make sure that your Mumble server is running. You may now open `https://voice.example.com` in a web browser. You will be prompted for server details: choose either `address: voice.example.com/demo` with `port: 443` or `address: voice.example.com` with `port: 443/demo`. You may prefill these values by appending `?address=voice.example.com/demo&port=443`. Choose a username, and click `Connect`: you should now be able to talk and use the chat.

Here is an example of systemd service, put it in `/etc/systemd/system/mumble-web.service` and adapt it to your needs:
```
[Unit]
Description=Mumble web interface
Documentation=https://github.com/johni0702/mumble-web
Requires=network.target mumble-server.service
After=network.target mumble-server.service

[Service]
Type=simple
User=www-data
ExecStart=/usr/bin/websockify --web=/usr/lib/node_modules/mumble-web/dist --ssl-target localhost:64737 localhost:64738

[Install]
WantedBy=multi-user.target
```

Then
```
systemctl daemon-reload
systemctl start mumble-web
systemctl enable mumble-web
```

## Configuration
The `app/config.js` file contains default values and descriptions for all configuration options.
You can overwrite those by editing the `config.local.js` file within your `dist` folder. Make sure to back up and restore the file whenever you update to a new version.

## Themes
The default theme of mumble-web tries to mimic the excellent [MetroMumble]Light theme.
mumble-web also includes a dark version, named MetroMumbleDark, which is heavily inspired by [MetroMumble]'s dark version.

To select a theme other than the default one, append a `theme=dark` query parameter (where `dark` is the name of the theme) when accessing the mumble-web page.
E.g. [this](https://voice.johni0702.de/?address=voice.johni0702.de&port=443/demo&theme=dark)is the live demo linked above but using the dark theme (`dark` is an alias for `MetroMumbleDark`).

Custom themes can be created by deriving them from the MetroMumbleLight/Dark themes just like the MetroMumbleDark theme is derived from the MetroMumbleLight theme.

## License
ISC

[Mumble]: https://wiki.mumble.info/wiki/Main_Page
[websockify GitHub page]: https://github.com/novnc/websockify
[MetroMumble]: https://github.com/xPoke/MetroMumble

