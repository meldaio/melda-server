const SEGMENTS = ["namespace", "project", "stage", "cell"]

module.exports = class MeldaUri {
  /**
   * Parses uri string in this format:
   *   namespace/project/stage/cell
   * @param  {String} uri Melda uri string
   * @return {Object}
   */
  static parse(uri) {
    var [ namespace, project, stage, cell ] = uri
      .replace(/^\//, "")
      .replace(/\/$/, "")
      .split("/")
      .map(segment => segment || undefined)

    return { namespace, project, stage, cell }
  }
  /**
   * Sets segments for the given uri.
   * @param  {Mixed} uri Parsed uri object or uri string
   */
  constructor(uri) {
    if (typeof uri === "string") {
      uri = this.constructor.parse(uri)
    } else if (Array.isArray(uri)) {
      uri = uri.reduce((acc, item, i) => {
        acc[ SEGMENTS[i] ] = item || undefined
        return acc
      }, {})
    }

    SEGMENTS.forEach(segment => this[segment] = uri[segment])
  }

  toString() {
    return this.build()
  }

  build(type = "all") {
    var segments = this.asArray()

    if (segments.length === 0) {
      return null
    }

    if (type === "all") {
      return segments.join("/")
    }

    var ind = SEGMENTS.indexOf(type)
    var _ind = ind + 1

    if (ind < 0) {
      return null
    }

    while (--_ind) {
      if ( ! segments[_ind] ) {
        return null
      }
    }

    return segments
      .slice(0, ind + 1)
      .join("/")
  }

  asArray() {
    for (var i = 0; i < SEGMENTS.length; i++) {
      if ( ! this[SEGMENTS[i]] ) {
        break
      }
    }

    return SEGMENTS.slice(0, i)
      .map(segment => this[segment])
  }
}




function test() {
  var uris = [
    [
      new MeldaUri("ns/pro/stag/c"),
      "ns/pro/stag/c",
      "ns/pro/stag/c",
      "ns/pro/stag",
      "ns/pro",
      "ns"
    ],
    [
      new MeldaUri("ns//stag/c"),
      "ns",
      null,
      null,
      null,
      "ns",
    ],
    [
      new MeldaUri(["ns", "pro"]),
      "ns/pro",
      null,
      null,
      "ns/pro",
      "ns",
    ],
    [
      new MeldaUri([null, "pro", null, 4]),
      null,
      null,
      null,
      null,
      null,
    ],
    [
      new MeldaUri({
        namespace: "ns",
        project: "pro",
        stage: "stag"
      }),
      "ns/pro/stag",
      null,
      "ns/pro/stag",
      "ns/pro",
      "ns",
    ],
    [
      new MeldaUri({
        namespace: "ns",
        project: "pro",
        cell: 3
      }),
      "ns/pro",
      null,
      null,
      "ns/pro",
      "ns",
    ]
  ]

  uris.forEach((test, i) => {
    var uri = test[0]
    console.log(i, "all", uri.build() === test[1])
    console.log(i, "cell", uri.build("cell") === test[2])
    console.log(i, "stage", uri.build("stage") === test[3])
    console.log(i, "project", uri.build("project") === test[4])
    console.log(i, "namespace", uri.build("namespace") === test[5])
  })
}

// test()