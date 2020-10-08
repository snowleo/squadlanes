let capturePoints = null;
let cpBluforMain = null;
let cpOpforMain = null;
let cpLines = null;
let map = null;
let ownMain = null;
let allLanes = null;
let laneLengths = null;
let raasData = null;
const raasDataSubscriber = new Set();

const CP_POSSIBLE = 0
const CP_CONFIRMED = 1
const CP_IMPOSSIBLE = 2

const CLR_CONFIRMED = "rgb(0,255,13)";
const CLR_ACTIVE = "rgb(176,255,148)";
const CLR_MID_POINT = "rgb(186,0,255)";
const CLR_DEF_POINT = "rgb(0,55,255)";
const CLR_DEF_OTHER = [
    "rgb(47,182,255)",
    "rgb(145,245,220)",
    "rgb(161,250,186)",
];
const CLR_OFF_POINT = "rgb(255,0,0)";
const CLR_OFF_OTHER = [
    "rgb(255,162,92)",
    "rgb(252,227,108)",
    "rgb(253,246,203)",
];
const CLR_IMPOSSIBLE = "rgb(145,145,145)";
const CLR_MAIN_BASE = "rgb(0,0,0)";

const CLR_PRIORITY = {
    // priority 99 means that caps aren't eligible for other colours anyway
    CONFIRMED: 99,
    IMPOSSIBLE: 99,
    MAIN_BASE: 99,
    ACTIVE: 8,
    MID_POINT: 6,
    DEF_POINT: 4,
    OFF_POINT: 2,
    OTHER: 0,
}

class Path {
    constructor(parent_dict, destination) {
        const path = [];
        let cur = destination;
        do {
            path.push(cur);
            cur = parent_dict[cur.name];
        } while (cur !== undefined);

        this.length = path.length - 1;
        this.path = path.reverse();
    }

    head() {
        return this.path[0];
    }

    tail() {
        return this.path[this.path.length - 1];
    }

}

class CapturePoint {
    constructor(name, displayName, pos) {
        this.name = name;
        this.displayName = displayName;
        this.pos = pos;
        this.laneDepths = {};
        this.neighbours = {};
        this.circleMarker = null;
        this.follower = null;
    }

    addLane(lane, depth) {
        this.laneDepths[lane] = depth;
    }

    pathsFrom(cpOther, restrictToLanes = null) {
        if (restrictToLanes === null) {
            restrictToLanes = new Set(allLanes);
        }
        let paths = {};
        restrictToLanes.forEach(lane => {
            paths[lane] = this.pathFromSingleLane(cpOther, lane);
        })
        return paths;
    }

    pathFromSingleLane(cpOther, lane) {
        // BFS
        const visited = new Set([cpOther]);
        const parent = {};
        const queue = new Queue();
        let thisFound = false;
        queue.enqueue(cpOther);

        while (!queue.isEmpty()) {
            const cur = queue.dequeue();
            if (cur === this) {
                thisFound = true;
                break;
            }
            if (!(lane in cur.neighbours)) {
                continue;
            }
            cur.neighbours[lane].forEach(nb => {
                // if cur already has a different follower, don't consider nb for paths
                if (cur.follower !== null && cur.follower !== nb) {
                    return;
                }
                // don't look back
                if ((ownMain === cpBluforMain && cur.laneDepths[lane] > nb.laneDepths[lane])
                    || (ownMain === cpOpforMain && cur.laneDepths[lane] < nb.laneDepths[lane])) {
                    return;
                }
                if (!visited.has(nb)) {
                    visited.add(nb);
                    parent[nb.name] = cur;
                    queue.enqueue(nb);
                }
            });
        }

        if (!thisFound) {
            return null;
        }

        return new Path(parent, this);
    }

    distanceFrom(cpOther, onlyPossibleRoutes = true) {
        let lanes = null;
        if (onlyPossibleRoutes) {
            lanes = possibleLanes();
        }
        // try all these lanes and return the shortest distance
        // we need to try the lanes separately to avoid generating impossible paths that rely on using multiple lanes
        const paths = this.pathsFrom(cpOther, lanes);
        let shortestDist = Number.MAX_VALUE;
        for (const lane in paths) {
            if (paths[lane] !== null) {
                shortestDist = Math.min(shortestDist, paths[lane].length);
            }
        }
        return shortestDist;
    }

    distanceToOwnBase() {
        return this.distanceFrom(ownMain);
    }

    equal(cpOther) {
        return this.name === cpOther.name
            || pointDistance(this.pos, cpOther.pos) < 10.0
    }

    /*
    Checks if the specified CP is a neighbour of this CP and returns the name of the lane on which it is a neighbour.
    If the CPs are neighbours on multiple lanes, it is not specified which lane is returned.

    If the CPs are not neighbours, false is returned.
     */
    isNeighbour(cpOther) {
        for (const lane in this.neighbours) {
            if (this.neighbours[lane].has(cpOther)) {
                return lane;
            }
        }
        return false;
    }

    possibleNeighbours() {
        let pn = new Set();
        for (const lane in this.neighbours) {
            if (!possibleLanes().has(lane)) {
                continue
            }
            pn = union(pn, this.neighbours[lane]);
        }
        return pn;
    }

    status() {
        if (this.confirmed()) {
            return CP_CONFIRMED;
        }
        // If the CP is not reachable from main (which side we're playing doesn't matter)
        if (this.distanceFrom(ownMain) === Number.MAX_VALUE) {
            return CP_IMPOSSIBLE;
        }
        return CP_POSSIBLE;
    }

    active() {
        let active = false;
        // check if there is a confirmed neighbour that is the end of the confirmation line
        this.possibleNeighbours().forEach(nb => {
            if (nb.status() === CP_CONFIRMED && nb.follower === null) {
                active = true;
            }
        })
        return active;
    }

    confirmed() {
        let cur = ownMain;
        do {
            if (cur === this) {
                return true;
            }
            cur = cur.follower;
        } while (cur !== null)
        return false;

    }

    labelInfo() {
        if (this === cpBluforMain || this === cpOpforMain) {
            // only use actual distance if a main base has been selected
            if (ownMain === cpBluforMain || ownMain === cpOpforMain) {
                return {
                    color: CLR_MAIN_BASE,
                    number: this.distanceToOwnBase(),
                };
            } else {
                return {
                    color: CLR_MAIN_BASE,
                    number: "&nbsp",
                };
            }

        }
        switch (this.status()) {
            case CP_CONFIRMED:
                return {
                    color: CLR_CONFIRMED,
                    number: this.distanceToOwnBase(),
                };
            case CP_IMPOSSIBLE:
                return {
                    color: CLR_IMPOSSIBLE,
                    number: "&nbsp",
                };
            default:
        }

        if (this.active()) {
            return {
                color: CLR_ACTIVE,
                number: this.distanceToOwnBase(),
            };
        }


        let cur_prio = Number.MIN_SAFE_INTEGER;
        let cur_info = null;
        for (const lane in this.laneDepths) {
            if (!possibleLanes().has(lane)) {
                continue;
            }
            const path = this.pathFromSingleLane(ownMain, lane);
            if (path === null) {
                continue;
            }
            const dist = path.length;
            if (this.name === "Marina") {
                console.log();
            }
            const def_depth = Math.floor(laneLengths[lane] / 2);
            let off_depth = def_depth + 1;
            // only check for mid-points on lanes with uneven capture points
            if (laneLengths[lane] % 2 === 1) {
                const mid_depth = off_depth;
                off_depth += 1;
                if (dist === mid_depth && cur_prio < CLR_PRIORITY.MID_POINT) {
                    cur_prio = CLR_PRIORITY.MID_POINT;
                    cur_info = {
                        color: CLR_MID_POINT,
                        number: dist,
                    };
                    continue;
                }
            }
            if (dist === def_depth && cur_prio < CLR_PRIORITY.DEF_POINT) {
                cur_prio = CLR_PRIORITY.DEF_POINT;
                cur_info = {
                    color: CLR_DEF_POINT,
                    number: dist,
                };
                continue;
            }
            if (dist === off_depth && cur_prio < CLR_PRIORITY.OFF_POINT) {
                cur_prio = CLR_PRIORITY.OFF_POINT;
                cur_info = {
                    color: CLR_OFF_POINT,
                    number: dist,
                };
                continue;
            }
            if (dist < def_depth && cur_prio < CLR_PRIORITY.OTHER) {
                const offset = def_depth - dist;
                cur_prio = CLR_PRIORITY.OTHER - offset;
                cur_info = {
                    color: CLR_DEF_OTHER[offset - 1],
                    number: dist,
                };
                continue;
            }
            if (dist > off_depth && cur_prio < CLR_PRIORITY.OTHER) {
                const offset = dist - off_depth;
                cur_prio = CLR_PRIORITY.OTHER - offset;
                cur_info = {
                    color: CLR_OFF_OTHER[offset - 1],
                    number: dist,
                };
                continue;
            }
        }
        return cur_info;
    }

    onClick() {
        // ignore clicks on own main
        if (this === ownMain) {
            return;
        } else // clicks on another main will trigger a reset
        if (this === cpBluforMain || this === cpOpforMain) {
            ownMain = this;
            resetConfirmations();
            return;
        }
        const s = this.status();
        // Ignore clicks on mandatory and impossible CPs
        if (s === CP_IMPOSSIBLE) {
            return;
        }

        // Ignore clicks on possible but inactive CPs
        if (s === CP_POSSIBLE && !this.active()) {
            return;
        }

        // Ignore clicks on confirmed points of they're not the end of the confirmation line
        if (s === CP_CONFIRMED && this.follower !== null) {
            return;
        }

        const cpLaneSet = new Set(Object.keys(this.laneDepths));
        if (s !== CP_CONFIRMED) {
            // confirm CP
            lastConfirmedPoint().follower = this;
        } else {
            // un-confirm CP
            let cur = ownMain;
            while (cur.follower !== null) {
                if (cur.follower === this) {
                    cur.follower = null;
                    break;
                }
                cur = cur.follower;
            }

        }
        // re-check possibility of all cps and re-color them
        redrawCpInfo();
        redrawCpLines();
    }
}

function resetConfirmations() {
    capturePoints.forEach(cp => {
        cp.follower = null;
    });
    redrawCpInfo();
    redrawCpLines();
}

function possibleLanes() {
    const poss = new Set(allLanes);
    let cur = ownMain;
    while (cur.follower !== null) {
        // check which lanes support this traversal
        for (const lane in cur.neighbours) {
            if (!cur.neighbours[lane].has(cur.follower)) {
                poss.delete(lane);
            }
        }
        cur = cur.follower;
    }
    return poss;
}

function pointDistance(posA, posB) {
    return Math.sqrt(
        Math.pow(posA[0] - posB[0], 2)
        + Math.pow(posA[1] - posB[1], 2)
    )
}

function union(setA, setB) {
    return new Set([...setA, ...setB]);
}

function intersection(setA, setB) {
    return new Set([...setA].filter(x => setB.has(x)));
}

function difference(setA, setB) {
    return new Set([...setA].filter(x => !setB.has(x)));
}

function lastConfirmedPoint() {
    let cur = ownMain;
    while (cur.follower !== null) {
        cur = cur.follower;
    }
    return cur;
}

function redrawCpInfo() {
    capturePoints.forEach(cp => {
        // Try each lane. Only display lanes which can lead to this CP with the current confirmation line
        let lanes = [];
        for (const lane in cp.laneDepths) {
            const path = cp.pathFromSingleLane(ownMain, lane);
            if (path !== null) {
                lanes.push(`${path.length}${lane[0]}`);
            }
        }

        const labelInfo = cp.labelInfo();
        if (cp === cpOpforMain || cp === cpBluforMain
            || allLanes.size === 1) {
            lanes = "&nbsp";
        }
        cp.circleMarker.closeTooltip().unbindTooltip();
        if (cp.status() === CP_IMPOSSIBLE && cp !== cpOpforMain && cp !== cpBluforMain) {
            cp.circleMarker.setStyle({
                opacity: 0.0,
                interactive: false,
                fill: false,
            });
        } else {
            cp.circleMarker.bindTooltip(
                `<div class="cpTooltipName">${cp.displayName}</div>` +
                `<div class="cpTooltipDepth">${labelInfo.number}</div>` +
                `<div class="cpTooltipLanes">${lanes}</div>`, {
                    permanent: true,
                    direction: 'top',
                    opacity: 1.0,
                    className: 'cpTooltip',
                    pane: 'cpTooltip',
                    offset: [0, 50],
                }).openTooltip();
            cp.circleMarker.setStyle({
                color: labelInfo.color,
                opacity: 1.0,
                interactive: true,
                fill: true,
            });

        }
        cp.circleMarker.redraw();
    });
    const laneList = document.getElementById("lanes");
    laneList.innerHTML = "";
    const poss = possibleLanes();
    allLanes.forEach(lane => {
        if (poss.has(lane)) {
            laneList.innerHTML += `<div class="lane possible">${lane}</div>`
        } else {
            laneList.innerHTML += `<div class="lane impossible">${lane}</div>`
        }
    })
}

function redrawCpLines() {
    cpLines.forEach(line => {
        line.remove();
    })
    let cur = ownMain;
    while (cur.follower !== null) {
        // only connect neighbouring CPs when both are confirmed or mandatory
        const line = L.polyline([cur.pos, cur.follower.pos], {
            color: "rgb(102,202,193)",
            pane: "cpLines",
        }).addTo(map);
        cpLines.add(line);
        cur = cur.follower;
    }

}

function loadRaasDataFromString(yamlString) {
    raasData = YAML.parse(yamlString);
    changeMap("Narva", "RAAS v1");
    triggerRaasDataSubscribers();
}

function loadRaasData(path, callback) {
    YAML.load(path, rd => {
        raasData = rd;
        callback();
        triggerRaasDataSubscribers();
    });
}

function onRaasDataLoad(callback) {
    raasDataSubscriber.add(callback);
}

function triggerRaasDataSubscribers() {
    raasDataSubscriber.forEach(callback => {
        callback();
    });
}

function changeMap(mapName, layerName) {
    // reset map data
    if (map !== null) {
        map.remove();
    }
    capturePoints = new Set();
    cpBluforMain = null;
    cpOpforMain = null;
    cpLines = new Set();
    ownMain = null;
    allLanes = new Set();
    laneLengths = {};

    const layer_data = raasData[mapName][layerName];

    const bounds = layer_data["background"]["corners"]
    const x_stretch = layer_data["background"]["x_stretch_factor"]
    const y_stretch = layer_data["background"]["y_stretch_factor"]
    const laneGraph = layer_data["lanes"]

    const baseBounds = [[bounds[0]["y"], bounds[0]["x"]], [bounds[1]["y"], bounds[1]["x"]]];
    const width = Math.abs(bounds[0]["x"] - bounds[1]["x"]);
    const height = Math.abs(bounds[0]["y"] - bounds[1]["y"]);

    const up_left_x = Math.min(bounds[0]["x"], bounds[1]["x"]);
    const up_left_y = Math.min(bounds[0]["y"], bounds[1]["y"]);
    const crs = L.extend({}, L.CRS.Simple, {
        // Move origin to upper left corner of map
        // need to do this because TileLayer always puts the left-upper corner on the origin
        transformation: new L.Transformation(x_stretch, -up_left_x, y_stretch, -up_left_y),
    });

    map = L.map('map', {
        crs: crs,
        minZoom: -10,
        maxZoom: -5,
        zoomSnap: 0.1,
        zoomDelta: 1.0,
        dragging: true,
        boxZoom: true,
        scrollWheelZoom: true,
        touchZoom: true,
        zoomControl: true,
        doubleClickZoom: false,
        attributionControl: false,
    });

    map.fitBounds(baseBounds);
    map.createPane('cp');
    map.getPane('cp').style.zIndex = 20;
    map.createPane('cpTooltip');
    map.getPane('cpTooltip').style.zIndex = 30;
    map.createPane('cpLines');
    map.getPane('cpLines').style.zIndex = 10;
    map.createPane('background');
    map.getPane('background').style.zIndex = 0;


    // scale tiles to match map width and height
    const zoomOffset = 12;
    const tileSize = [width / Math.pow(2, zoomOffset), height / Math.pow(2, zoomOffset)];
    let map_image_name = layer_data["background"]["minimap_filename"];
    new L.TileLayer(`map-resources/tiles/${map_image_name}/{z}/{x}/{y}.png`, {
        tms: false,
        minZoom: -12,
        maxNativeZoom: -8,
        zoomOffset: zoomOffset,
        tileSize: L.point(tileSize),
        pane: 'background',
        bounds: baseBounds,
    }).addTo(map);

    // extract capture points from YAML data
    // this is also the set of vertices
    for (const lane in laneGraph) {
        for (let depth in laneGraph[lane]) {
            for (const sdk_name in laneGraph[lane][depth]) {
                depth = parseInt(depth);
                cpRaw = laneGraph[lane][depth][sdk_name];
                cp = new CapturePoint(
                    sdk_name,
                    cpRaw["display_name"],
                    [cpRaw["y"], cpRaw["x"]]
                );
                cp.addLane(lane, depth);
                let foundEqual = false;
                capturePoints.forEach(cpOther => {
                    if (cp.equal(cpOther)) {
                        foundEqual = true;
                        cpOther.addLane(lane, depth);
                    }
                })
                if (!foundEqual) {
                    capturePoints.add(cp);
                    if (depth === 0) {
                        cpBluforMain = cp;
                    } else if (depth === Object.keys(laneGraph[lane]).length - 1) {
                        cpOpforMain = cp;
                    }
                }
                allLanes.add(lane);
                laneLengths[lane] = Object.keys(laneGraph[lane]).length - 2; // amount of non-main CPs
            }
        }
    }

    // generate set of edges
    capturePoints.forEach(cpA => {
        capturePoints.forEach(cpB => {
            if (cpA === cpB) {
                return;
            }
            for (const lane in cpA.laneDepths) {
                if (!cpB.laneDepths.hasOwnProperty(lane)) {
                    continue;
                }
                if (Math.abs(cpA.laneDepths[lane] - cpB.laneDepths[lane]) === 1) {
                    if (!cpA.neighbours.hasOwnProperty(lane)) {
                        cpA.neighbours[lane] = new Set();
                    }
                    cpA.neighbours[lane].add(cpB);
                    if (!cpB.neighbours.hasOwnProperty(lane)) {
                        cpB.neighbours[lane] = new Set();
                    }
                    cpB.neighbours[lane].add(cpA);
                }
            }
        })
    })

    ownMain = new CapturePoint("dummy main", "dummy main", [0.0, 0.0]);

    // create markers for capture points
    capturePoints.forEach(cp => {
        const circleMarker = L.circleMarker(cp.pos, {
            radius: 20,
            pane: 'cp',
        });
        circleMarker.cp = cp;
        cp.circleMarker = circleMarker;
        circleMarker.on('click', ev => {
            cp.onClick()
        });
        circleMarker.addTo(map);
        circleMarker.on('mouseover', ev => {
            const tt = circleMarker.getTooltip();
            if (tt !== undefined) {
                // this will probably break at some point
                L.DomUtil.addClass(tt._container, 'mouseover');
            }
            // re-open tooltip to make sure text is still centered
            circleMarker.closeTooltip();
            circleMarker.openTooltip();
        })
        circleMarker.on('mouseout', ev => {
            const tt = circleMarker.getTooltip();
            if (tt !== undefined) {
                L.DomUtil.removeClass(tt._container, 'mouseover');
            }
            circleMarker.closeTooltip();
            circleMarker.openTooltip();
        })
    })

    redrawCpInfo();
    redrawCpLines();

    // Debug
    if (window.location.hostname.startsWith("dev.")) {
        map.addEventListener('mousedown', function (ev) {
            const lat = ev.latlng.lat;
            const lng = ev.latlng.lng;
            console.log(`Pos: X=${lng} Y=${lat}`);
        });
    }

    const mapDiv = document.getElementById("map");
    new ResizeObserver(() => {
        map.invalidateSize();
        map.fitBounds(baseBounds, {
            animate: false,
        });
    }).observe(mapDiv);
}
