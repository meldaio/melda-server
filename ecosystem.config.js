module.exports = {
  /**
   * Application configuration section
   * http://pm2.keymetrics.io/docs/usage/application-declaration/
   */
  apps : [

    // melda.io main
    { 
      name: "melda-server",
      script: "index.js",
      watch: false,
      ignore_watch: [
        ".gitignore",
        ".git",
        "node_modules",
        "uploads",
        "logs"
      ], },

  ]
}
