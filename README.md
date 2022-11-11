# Installation

## Requirements

### Install docker CE and docker-compose
https://docs.docker.com/install/
https://docs.docker.com/compose/install/ 

### Pull the microservice source code
The following git repositories have to be cloned inside the same directory :

- melda-server
- melda-client
- melda-jupyter
- melda-kernel-manager
- melda-file-manager
- melda-rmd-converter

### Build melda-jupyter docker container
Instructions can be found in the README.md of melda-jupyter repo.

### Build melda-kernel-manager
Instructions can be found in the README.md of melda-kernel-manager repo.

### Create a .env file.
```sh
$ cp .env.example .env
```

Then update the parameter DEFAULT_DEPLOYMENT according to your needs.

## Deployment Drivers
Here we decide where we run lanuage kernels.


1. Install node and npm.
2. Install Jupyter. For an easy installation and an all in one package with some extra data science tools see [Anaconda](https://www.anaconda.com/download/).
3. Clone the VisualR repository.
4. Open a unix-like shell and change working directory to the repository directory.
5. Install dependencies with `npm install`
6. Start VisualR with `npm run start`

# Running
1. Start mongo daemon with `sudo service mongod start` as root user.
2. Start jupyter with `jupyter notebook` as visualr.
3. Copy token from the jupyter output. Paste it to .env file in rculture-ide-dev.
4. Start visualr with `pm2 start ecosystem.config.js`.
5. Optional: `pm log all` to see if it is started.

# API documentation

## HTTP endpoints

### GET    /api/projects
### GET    /api/recent-projects
### GET    /api/new
### POST   /api/save
### GET    /api/project/:project
### DELETE /api/project/:project

### GET    /api/project/:project/new
### DELETE /api/project/:project/:stage
### GET    /api/preview/:project/:stage

### GET    /api/cell-html/:id

## Socket endpoints

### init-stage
### leave-stage
### new-cell