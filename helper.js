// ==UserScript==
// @name         Pipeline Helper
// @namespace    http://compass.com/
// @version      0.1
// @description  Enhance the capability of pipeline
// @author       You
// @match        https://pipelines.compass.com/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant       GM_xmlhttpRequest
// @connect     compass.com
// ==/UserScript==

let pipeline;

function getLog(stageName, podId, cb) {
    const logRange = 3600*48
    const stage = pipeline.stages.find(s => s['clusterStage'] === stageName);
    const container = stage.lastDeploy.deployment.spec.template.spec.containers[0].name;
    const url = `https://pipelines.compass.com/api/v1/teams/${pipeline.team}/applications/${pipeline.application}/clusters/${stageName}/${stage.clusterName}/deployments/default/${stage.lastDeploy.deployment.metadata.name}/logs?podId=${podId}&container=${container}&sinceSeconds=${logRange}`
    GM_xmlhttpRequest({
        url,
        method: "GET",
        responseType: "json",
        headers: {
            "authorization": `Bearer ${token()}`
        },
        onload: function (data) {
            try {
                const lines = data.response.split('\n')
                const jsons = lines.map(l => {
                    try {
                        return JSON.parse(l);
                    } catch (e) {
                    }
                }).filter(t => !!t).map(o => {
                    o.time = moment(o.time, "YYYYMMDD hh:mm:ss.SSS");
                    return o;
                });
                cb(null, jsons)
            } catch(e) {
                console.log('getLog error:', data)
            }
        }
    })
}

function getLogs(stageName, podIds, onload) {
    async.map(podIds, getLog.bind(null, stageName), (err, r) => {
        onload(null, [].concat(...r).sort((l, r) => r.time - l.time))
    })
}

function token() {
    const session = JSON.parse(localStorage.getItem('PIPELINES_SERVICE_SESSION'))
    return session && session.token;
}

function addDialog() {
    $("body").append(`
<div id="logModal" class="modal" style="background: white;
  display: none;
  position: fixed;
  left: 100px;
  top: 100px;
  right: 100px;
  bottom: 100px;
  padding: 88px;
  ">
  <button id="closeLogModal" style="position: absolute; right: 20px; top: 20px; background: transparent; padding: 16px; color: black">
     X 
</button>
<div id="logContent" style="overflow: auto; width: 100%; height: 100%">
</div>
</div>
`);

    $("#closeLogModal").on('click', () => {
        $("#logModal").hide();
    })
}


function setLogs(allLogs) {
    const modal = $("#logContent");
    for (let log of allLogs) {
        const lineElem = $('<div class="logModalLine"></div>')
        const line = `${log.time.format()} ${log.level} ${log.message} `
        lineElem.text(line);
        lineElem.addClass(log.level || log.status)
        modal.append(lineElem)
    }
}

function setLoading(isLoading) {
    $("#viewLog").prop('disabled', isLoading)
}

function showLogDialog(stageName) {
    setLoading(true);
    const stage = pipeline.stages.find(s => s['clusterStage'] === stageName);
    GM_xmlhttpRequest({
        url: `https://pipelines.compass.com/api/v1/teams/${pipeline.team}/applications/${pipeline.application}/clusters/${stageName}/${stage.clusterName}/deployments/default/${stage.lastDeploy.deployment.metadata.name}`,
        method: "GET",
        responseType: "json",
        headers: {
            "authorization": `Bearer ${token()}`
        },
        onload: function (data) {
            if (!data.response.items) {
                console.log("response error:", data.response)
            }
            const podIds = data.response.items.map(t => t.metadata.name)
            getLogs(stageName, podIds, (err, allLogs) => {
                console.log("logs", allLogs)
                $("#logModal").show();
                setLogs(allLogs);
                setLoading(false);
            })
        }
    })
}

function addLogButtons(node) {
    const btn = $(node).parent()
    const style = "-webkit-box-pack: center;\n" +
        "    justify-content: center;\n" +
        "    padding: 5px 8px;\n" +
        "    width: fit-content;\n" +
        "    height: fit-content;\n" +
        "    font-style: normal;\n" +
        "    font-size: 12px;\n" +
        "    background: rgb(255, 255, 255);\n" +
        "    color: rgb(0, 73, 168);\n" +
        "    border: 1px solid rgb(0, 73, 168);\n" +
        "    border-radius: 5px;\n" +
        "    font-weight: 700;\n" +
        "    margin: 10px;"
    const viewLogBtn = $(`<button id="viewLog" style="${style}">View Logs</button>`)
    btn.append(viewLogBtn)
    viewLogBtn.on("click", (elem) => {
        const text = $(elem.target).parent().parent().parent().parent().parent().find("h5:contains('Stage')").text();
        const stage = text.split(' ')[0]
        showLogDialog(stage);
    });
}

let styleAdded;
function addStyles() {
    if (styleAdded) return;
    GM_addStyle(`
        #logContent {
            padding: 16px; 
            border: black 2px solid;
            line-height: 140%;
        }
        
        #logContent .warn {
            color: rgb(249, 156, 34);
        }
        #logContent .info {
            color: rgb(32, 190, 74);
        }
        
        #logContent .error {
            color: rgb(241, 57, 44)
        }
    `)
    styleAdded = true;
}


function loadPipeline() {
    const segs = window.location.pathname.split('/')
    if (segs.length !== 5 ||segs[1] !== 'teams' || segs[3] !== 'apps' ) {
        return;
    }

    const team = segs[2]
    const app = segs[4];
    GM_xmlhttpRequest({
        url: `https://pipelines.compass.com/api/v1/pipelines/${team}/${app}?refresh=true`,
        method: "GET",
        responseType: "json",
        headers: {
            "authorization": `Bearer ${token()}`
        },
        onload: function (data) {
            if (!data.response) {
                console.log("response error:", data.response)
            }

            pipeline = data.response;
        }
    })
}

(function () {
    'use strict';
    pipeline = null;
    loadPipeline();
    waitForKeyElements("button:contains('View Pod Details')", (node) => {
        addStyles();
        addLogButtons(node);
    }, true)

    addDialog();

    if (!token()) {
        return;
    }
})();
