// ==UserScript==
// @name         Pipeline Helper
// @namespace    http://compass.com/
// @version      0.1
// @description  Enhance the capability of pipeline
// @author       You
// @match        https://pipelines.compass.com/*
// @grant       GM_xmlhttpRequest
// @connect     compass.com
// ==/UserScript==


(function () {
    let pipeline;
    let showLogButton;
    let firstLoadTime;
    let updateLogTask;
    let styleAdded;

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

    function getLog(stageName, logRange, podId, cb) {
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
                        let t = moment(o.time, "YYYYMMDD hh:mm:ss.SSS")
                        if (!t.isValid()) {
                            t = moment(o.time);
                        }
                        o.time = t;
                        o.level = o.level || o.status;
                        return o;
                    });
                    cb(null, jsons)
                } catch (e) {
                    console.log('getLog error:', data, e)
                    cb(e, null)
                }
            }
        })
    }

    function getLogs(stageName, podIds, instantLogs, onload) {
        let logRange;
        if (instantLogs) {
            logRange = Math.floor((new Date().getTime() - firstLoadTime.getTime()) / 1000)
        } else {
            logRange = 3600 * 7
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
    }


    function setLogs(allLogs, append) {
        let modal;
        if (append) {
            modal = $("#logContent #newLogs");
        } else {
            modal = $("#logContent #logs");
        }

        modal.empty();
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
            const text = $(elem.target).parent().parent().parent().parent().parent().find("h5:contains('Stage')").text();
            const stage = text.split(' ')[0]
            showLogButton = $(elem.target)
            showLogDialog(stage);
        });
    }


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
          padding: 88px;
          position: absolute;
          left: 100px;
          top: 100px;
          bottom: 100px;
          right: 100px;
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
