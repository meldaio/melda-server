const stageManager = require("../stage-manager.js");
const { User, Stage } = require("../../models");

module.exports = {
  name: "Random stage run",
  description: "Attaches random stages and runs the cells in each of them",
  inputs: [{
    name: "Stage count",
    type: "number",
    default: 2
  }, {
    name: "Cell count",
    type: "number",
    default: 10
  }],

  stages: [],

  async start(inputs = []) {
    try {
      console.log(this.name, "test started");

      let [stageCount, cellCount] = inputs;
      stageCount = Number(stageCount || this.inputs[0].default);
      cellCount = Number(cellCount || this.inputs[0].default);

      let $sample = { size: stageCount };
      let records = await Stage.aggregate([{ $sample }]);
      let owners = await User.find({ _id: { $in: records.map(i => i.owner) } });

      let indexedOwners = {};
      owners.forEach(item => indexedOwners[item._id] = item.export());
      records = records.map(item => {
        return {
          id: item._id,
          owner: indexedOwners[item.owner]
        }
      });

      console.log("Records fetched, starting stages");
      
      let proms = records.map(async ({ id, owner }) => {
        this.stages.push(id);

        const stage = stageManager.getInstance(id, owner);
        const model = await stage.getModel();
        const cells = await model.getCells();

        for (let i = 0; i < cellCount; i++) {
          let cell = cells[i];
          if ( ! cell ) break;

          await stage.evalCell(cell._id, cell.language, cell.code, cell.owner);
          await sleeping();
        }
      });

      const stages = await Promise.all(proms);
      console.log("Test finished");
    } catch (err) {
      console.error("Test error", err)
    }
  },

  async stop() {
    for (let i = 0; i < this.stages.length; i++) {
      stageManager.detachStage(this.stages[i]);
    }
    console.log("All stages are detached")
  },

}

async function sleeping(seconds = 1) {
  return new Promise((res, rej) => setTimeout(() => res(), seconds * 1000))
}