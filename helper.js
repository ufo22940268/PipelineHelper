// ==UserScript==
// @name         Pipeline Helper
// @namespace    http://tampermonkey.net/
// @version      0.6
// @description  Enhance the capability of pipeline
// @author       You
// @match        https://pipelines.compass.com/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant       GM_xmlhttpRequest
// @grant       GM_addStyle
// @grant window.onurlchange
// @connect     compass.com
// @require     http://ajax.googleapis.com/ajax/libs/jquery/1.7.2/jquery.min.js
// @require  https://cdnjs.cloudflare.com/ajax/libs/async/3.2.4/async.min.js
// @require https://cdnjs.cloudflare.com/ajax/libs/moment.js/2.29.4/moment.min.js
// @require https://gist.githubusercontent.com/raw/2625891/waitForKeyElements.js
// ==/UserScript==

/* globals jQuery, $, waitForKeyElements */

(function () {
    let pipeline;
    let showLogButton;
    let firstLoadTime;
    let updateLogTask;
    let styleAdded;
    let autoRefresh = false;

    pipeline = null;

    if (window.onurlchange === null) {
        window.addEventListener('urlchange', (info) => {
            waitForKeyElements("button:contains('View Pod Details')", (node) => {
                loadPipeline(() => {
                    addLogButtons(node);
                })
            }, true)
        });
    }
    waitForKeyElements("button:contains('View Pod Details')", (node) => {
        addStyles();
        loadPipeline(() => {
            addLogButtons(node);
        })
    }, true)

    document.addEventListener('keyup', (event) => {
        if (event.code === 'Escape') dismissModal()
    }, false);

    addDialog();

    if (!token()) {
        return;
    }

    function parseStage(stage) {
        let container;
        let deployName;
        let type;
        if (pipeline.cronJobFile) {
            deployName = stage.lastDeploy.cronJob.metadata.name;
            container = stage.lastDeploy.cronJob.spec.jobTemplate.spec.template.spec.containers[0].name;
            type = "cronjob";
        } else {
            deployName = stage.lastDeploy.deployment.metadata.name;
            container = stage.lastDeploy.deployment.spec.template.spec.containers[0].name;
            type = "deployments";
        }
        return {deployName, container, type}
    }

    function getLog(stageName, logRange, podId, cb) {
        const stage = pipeline.stages.find(s => s['clusterStage'] === stageName);

        const {container, deployName, type} = parseStage(stage);
        let url = `https://pipelines.compass.com/api/v1/teams/${pipeline.team}/applications/${pipeline.application}/clusters/${stageName}/${stage.clusterName}/${type}/default/${deployName}/logs?podId=${podId}&container=${container}`
        if (logRange != -1) {
            url += `&sinceSeconds=${logRange}`;
        } else {
            url += `&previous=false`;
        }
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
                        let t = moment.utc(o.time, "YYYYMMDD hh:mm:ss.SSS").local()
                        if (!t.isValid()) {
                            t = moment.utc(o.time).local();
                        }
                        o.time = t;
                        o.level = o.level || o.status;
                        return o;
                    });
                    cb(null, jsons)
                } catch (e) {
                    console.log('getLog error:', data, e)
                    cb(null, [])
                }
            }
        })
    }

    function getLogs(stageName, podIds, instantLogs, onload) {
        let logRange;
        if (instantLogs) {
            logRange = Math.floor((new Date().getTime() - firstLoadTime.getTime()) / 1000)
        } else {
            logRange = -1
        }
        async.map(podIds, getLog.bind(null, stageName, logRange), (err, r) => {
            onload(null, [].concat(...r).sort((l, r) => r.time - l.time))
        })
    }

    function token() {
        const session = JSON.parse(localStorage.getItem('PIPELINES_SERVICE_SESSION'))
        return session && session.token;
    }

    function dismissModal() {
        $("#logModal").hide();
        $("body").removeClass("ReactModal__Body--open");
        clearInterval(updateLogTask);
    }

    function addDialog() {
        $("body").append(`
<div id="logModal" class="modal">
  <div id="logModalBackground"></div>
  
  <div id="logModalContainer">
  
    <div id="logModalMenubar">
         <input id="autoRefresh" type="checkbox" checked="false">Auto Refresh
    </div>
    <button id="closeLogModal" style="position: absolute; right: 20px; top: 20px; background: transparent; padding: 16px; color: black">
         X 
    </button>
    <div id="logContent" style="overflow: auto; width: 100%; height: 100%">
        <div id="newLogs"></div>
        <div id="logs"></div>
    </div>
  </div>
</div>
`);

        $("#closeLogModal").on('click', () => {
            dismissModal();
        })

        $("#logModalMenubar > #autoRefresh").on('click', (ev) => {
            console.log(ev.target.checked);
            autoRefresh = ev.target.checked;
        });
    }


    function setLogs(allLogs, append) {
        let modal;
        if (append) {
            modal = $("#logContent #newLogs");
        } else {
            modal = $("#logContent #logs");
        }

        modal.empty();
        allLogs.sort((l, r) => r.time - l.time);
        for (let log of allLogs) {
            const lineElem = $('<div class="logModalLine"></div>')
            const line = `${log.time.format()} ${log.level} ${log.message} `
            lineElem.text(line);
            lineElem.addClass(log.level || log.status)
            modal.append(lineElem)
        }
    }

    function setLoading(isLoading) {
        showLogButton.prop('disabled', isLoading)
        if (isLoading) {
            showLogButton.text('View Logs ...')
        } else {
            showLogButton.text('View Logs')
        }
    }

    function showLogDialog(stageName) {
        setLoading(true);
        const stage = pipeline.stages.find(s => s['clusterStage'] === stageName);
        firstLoadTime = new Date();
        const {deployName, type} = parseStage(stage);
        GM_xmlhttpRequest({
            url: `https://pipelines.compass.com/api/v1/teams/${pipeline.team}/applications/${pipeline.application}/clusters/${stageName}/${stage.clusterName}/${type}/default/${deployName}`,
            method: "GET",
            responseType: "json",
            headers: {
                "authorization": `Bearer ${token()}`
            },
            onload: function (data) {
                if (!data.response.items) {
                    console.log("response error:", data.response)
                    setLoading(showLogBtn, false);
                }

                const podIds = data.response.items.map(t => t.metadata.name)
                getLogs(stageName, podIds, false, (err, allLogs) => {
                    setLoading(false);
                    if (err) {
                        console.log("err:", err);
                        return;
                    }
                    $("#logModal").show();
                    $("#logContent").get(0).scrollTop = 0

                    $("body").addClass("ReactModal__Body--open");
                    setLogs(allLogs);

                    startUpdateLogTask(stageName, podIds);
                })
            }
        })
    }

    function startUpdateLogTask(stageName, podIds) {
        if (updateLogTask) clearInterval(updateLogTask)

        updateLogTask = setInterval(() => {
            if (!autoRefresh) return;
            getLogs(stageName, podIds, true, (err, logs) => {
                console.log("new logs = " + JSON.stringify(logs, null, 2));
                if (!logs) return;
                if (err) {
                    console.log('update task error', err);
                    return;
                }

                setLogs(logs, true);
            })
        }, 5000);
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
            const text = $(elem.target).parent().parent().parent().parent().find("h5:contains('Stage')").text();
            const stage = text.split(' ')[0]
            showLogButton = $(elem.target)
            console.log("stage---------------", text);
            showLogDialog(stage);
        });
    }


    function addStyles() {
        if (styleAdded) return;
        GM_addStyle(`
        #logContent {
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
        
        #logModal {
          display: none;
          position: fixed;
          left: 0;
          top: 0;
          height: 100%;
          width: 100%;
          overscroll-behavior: contain;
        }
        
        #logModalBackground {
          position: absolute;
          left: 0;
          top: 0;
          width: 100%;
          height: 100%;
          background: black;
          z-index: -1;
          opacity: 0.4;
        }
        
        #logModalContainer {
          background: white;
          padding: 48px;
          position: absolute;
          left: 20px;
          top: 30px;
          bottom: 20px;
          right: 20px;
          z-index: 100;
        }
    `)
        styleAdded = true;
    }


    function loadPipeline(onload) {
        const segs = window.location.pathname.split('/')
        if (segs.length !== 5 || segs[1] !== 'teams' || segs[3] !== 'apps') {
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
                onload()
            }
        })
    }

})();
