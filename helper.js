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


function getLog(podId, cb) {
    const url = `https://pipelines.compass.com/api/v1/teams/marketing-automation/applications/marketing-plans/clusters/gamma/gamma-backend-20211015/deployments/default/marketingautomation-marketingplans-deployment/logs?podId=${podId}&container=marketingautomation-marketingplans&previous=false`
    GM_xmlhttpRequest({
        url,
        method: "GET",
        responseType: "json",
        headers: {
            "authorization": `Bearer ${token()}`
        },
        onload: function (data) {
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
        }
    })
}

function getLogs(podIds, onload) {
    const r = {};
    async.map(podIds, getLog, (err, r) => {
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
  <button id="closeLogModal" style="position: absolute; left: 20px; top: 20px; background: transparent; padding: 16px; color: black">
     X 
</button>
<div id="logContent" style="overflow: auto; width: 100%; height: 100%">
wefojwiofejwojfowijfowjfeojiwef
weojwfeoij
</div>
</div>
`);

    $("#closeLogModal").on('click', () => {
        $("#logModal").hide();
    })
}


function setLogs(allLogs) {
    $("#logModal");
}

function showLogDialog() {
    GM_xmlhttpRequest({
        url: "https://pipelines.compass.com/api/v1/teams/marketing-automation/applications/marketing-plans/clusters/gamma/gamma-backend-20211015/deployments/default/marketingautomation-marketingplans-deployment",
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
            getLogs(podIds, (err, allLogs) => {
                console.log("logs", allLogs)
                $("#logModal").show();
                setLogs(allLogs);
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
    btn.append(`<button id="viewLog" style="${style}">View Logs</button>`)
    $("#viewLog").on("click", () => {
        showLogDialog();
    });
}

(function () {
    'use strict';

    waitForKeyElements("button:contains('View Pod Details')", (node) => {
        addLogButtons(node);
    }, true)

    addDialog();

    if (!token()) {
        return;
    }

    // showLogDialog();
})();
