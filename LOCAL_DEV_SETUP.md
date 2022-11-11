# ![melda.io](https://app.melda.io/dist/images/e96532e83d00fb1056e677d52bdb6bf0.png)melda.io Local Dev Environment Set Up
This guide is tested on Ubuntu 18.04.02

## Installation of Necessary Tools
In order to run melda.io on local enviroment, we need to install the neccessary tools.
 - NodeJS
 - MongoDB 
 - Redis
 - Docker

First update the packages list to have the most recent version of the repository listings:
```   
$ sudo apt update
```

### NodeJS
First check whether NodeJS is installed on your machine or not.
```
$ node -v
```

If you get the node version skip the NodeJS installation part. (Note: this guide is tested with NodeJS 12.x.x)

To install NodeJS,
```
$ curl -sL https://deb.nodesource.com/setup_12.x | sudo -E bash -
$ sudo apt-get install -y nodejs
```

Sometimes NodeJS doesn't come with npm, so check the npm version.
```
$ npm -v
```
If npm is already installed, everthing is fine so far. If not, install it.
```
$ sudo apt-get install npm
```

### MongoDB
First check whether MongoDB is installed in your machine or not. 
```
$ mongod --version
```

Skip the MongoDB installation, if you have MongoDB installed on your machine.

Now install the MongoDB package itself:
```
$ sudo apt install -y mongodb
```

The installation process started MongoDB automatically, but let’s verify that the service is started and that the database is working.
First, check the service’s status:
```
$ sudo systemctl status mongodb
```

You’ll see this output:
```
● mongodb.service - An object/document-oriented database
    Loaded: loaded (/lib/systemd/system/mongodb.service; enabled; vendor preset: 
    Active: active (running) since Mon 2020-01-06 13:10:49 +03; 2h 58min ago
    Docs: man:mongod(1)
    Main PID: 1316 (mongod)
        Tasks: 28 (limit: 4915)
        CGroup: /system.slice/mongodb.service
               └─1316 /usr/bin/mongod --unixSocketPrefix=/run/mongodb --config /etc/
```

According to `systemd`, the MongoDB server is up and running. If it is not active, you start MongoDB service manually.
```
$ sudo systemctl start mongodb
```

### Redis
Run below command from the terminal to install Redis on your machine:
```
$ sudo apt-get install redis-server
```

Next is to enable Redis to start on system boot. Also restart Redis service once.
```
$ sudo systemctl enable redis-server.service
```

### Docker
First Install a few prerequisite packages which let `apt` use packages over HTTPS:
```
$ sudo apt install apt-transport-https ca-certificates curl software-properties-common
```

Then add the GPG key for the official Docker repository to your system:
```
$ curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo apt-key add -
```

Add the Docker repository to APT sources:
```
$ sudo add-apt-repository "deb [arch=amd64] https://download.docker.com/linux/ubuntu bionic stable"
```

Make sure you are about to install from the Docker repo instead of the default Ubuntu repo:
```
$ apt-cache policy docker-ce
```

You’ll see output like this, although the version number for Docker may be different:
```
    docker-ce:
      Installed: (none)
      Candidate: 18.03.1~ce~3-0~ubuntu
      Version table:
         18.03.1~ce~3-0~ubuntu 500
            500 https://download.docker.com/linux/ubuntu bionic/stable amd64 Packages
Finally, install Docker:
```

Docker should now be installed, the daemon started, and the process enabled to start on boot. Check that it’s running:
```
$ sudo apt install docker-ce
```

The output should be similar to the following, showing that the service is active and running:
```
$ sudo systemctl status docker
```

The output should be similar to the following, showing that the service is active and running:
```
    ● docker.service - Docker Application Container Engine
       Loaded: loaded (/lib/systemd/system/docker.service; enabled; vendor preset: enabled)
       Active: active (running) since Thu 2018-07-05 15:08:39 UTC; 2min 55s ago
         Docs: https://docs.docker.com
     Main PID: 10096 (dockerd)
        Tasks: 16
       CGroup: /system.slice/docker.service
               ├─10096 /usr/bin/dockerd -H fd://
               └─10113 docker-containerd --config /var/run/docker/containerd/containerd.toml
```

## melda.io Microservices
### Pull the microservice source code
The following git repositories have to be cloned inside the same directory:
- melda-server
- melda-client
- melda-jupyter
- melda-kernel-manager
- melda-file-manager
- melda-rmd-converter

```
$ mkdir melda && cd 
$ git clone git@github.com:meldaio/melda-client
$ git clone git@github.com:meldaio/melda-server
$ git clone git@github.com:meldaio/melda-kernel-manager
$ git clone git@github.com:meldaio/melda-file-manager
$ git clone git@github.com:meldaio/melda-jupyter
$ git clone git@github.com:meldaio/melda-rmd-converter
```
### Configure and Run

#### melda-server
Create a copy of .env file.
```
$ cd melda-server
$ cp .env.example .env
```

Find the following code lines and edit it like below:
```
DEFAULT_DEPLOYMENT=LocalInstallment
```

Then, install node_modules:
```
$ npm install
```

To run:
```
$ npm start
```

#### melda-client
Create a copy of server.js
```
$ cp server.example.js server.js
```

Then edit server.js for local environment:
```
window.API_SERVER = "http://localhost:4000/api"
window.WEBSOCKET_SERVER = "http://localhost:4000"
window.KB_SERVER ="https://kb.melda.io/"
window.PG_OAUTH = "https://accounts.pranageo.com/update"
window.MELDA_WP = "https://melda.io/projects/"
```

Then install node_modules:
```   
$ npm install
```

To run:
```
$ npm start
```

#### melda-kernel-manager
Create a copy of .env file.
```
$ cd  melda-kernel-manager
$ cp .env.example .env
```

Then, install node_modules:
```
$ npm install
```   

To run:
```
$ npm start
```

#### melda-jupyter
To build and run: 
*This might take some time*
```
$ cd melda-jupyter
$ docker build -t melda-jupyter .
$ docker run -d -p 8888-8889:8888-8889 melda-jupyter
```