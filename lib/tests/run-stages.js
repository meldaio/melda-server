const stageManager = require("../stage-manager.js");
const { User, Stage } = require("../../models");

module.exports = {
  name: "Run specified stages",
  description: "Attaches given stages and runs all cells",
  inputs: [{
    name: "Stage URIs",
    type: "textarea"
  }],

  stages: [],

  async start(inputs = []) {
    try {
      let [stageUris] = inputs;
      stageUris = stageUris || "";
      
      stageUris = stageUris
        .split("\n")
        .map(uri => uri.trim())
        .filter(uri => !!uri);
      

      const stages = await Stage.find({ uri: { $in: stageUris } })
        .populate("owner");

      this.stages = stages.map(item => item._id.toString());
      const proms = stages.map(async record => {
        const stage = stageManager.getInstance(record._id, record.owner);
        const model = await stage.getModel();
        const cells = await model.getCells();

        for (let i = 0; i < cells.length; i++) {
          let cell = cells[i];
          await stage.evalCell(cell._id, cell.language, cell.code, cell.owner);
        }
      });

      await Promise.all(proms);
      console.log("Test finished");
    } catch (err) {
      console.error("Test error", err)
    }
  },

  async stop() {
    for (let i = 0; i < this.stages.length; i++) {
      stageManager.detachStage(this.stages[i]);
    }
    console.log("All stages are detached");
  },

}

async function sleeping(seconds = 1) {
  return new Promise((res, rej) => setTimeout(() => res(), seconds * 1000))
}