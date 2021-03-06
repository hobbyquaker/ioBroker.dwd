// TODO handle FTP timeouts

"use strict";

var JSFtp =         require('jsftp');
var parseString =   require('xml2js').parseString;

var ftp;
var files = [];
var xml = [];

var severity = {
    "Minor":    1,
    "Moderate": 2,
    "Severe":   3,
    "Extreme":  4
};

var adapter =       require(__dirname + '/../../lib/adapter.js')({

    name:           'dwd',

    ready: function () {

        adapter.config.kreis = (adapter.config.kreis + 'XXX').slice(0, 4);

        adapter.extendObject('warning', {
            type: 'channel',
            role: 'forecast',
            common: {
                name: 'dwd warning ' + adapter.config.dienststelle + ' ' + adapter.config.kreis
            },
            native: {

            },
            children: [
                "warning.begin",
                "warning.end",
                "warning.severity",
                "warning.text",
                "warning.headline",
                "warning.desc"
            ]
        });


        ftp = new JSFtp({
            host: adapter.config.host,
            user: adapter.config.user, // defaults to "anonymous"
            pass: adapter.config.pass // defaults to "@anonymous"
        });

        ftp.on('jsftp_debug', function (eventType, data) {
            adapter.log.debug('DEBUG: ', eventType);
            adapter.log.debug(JSON.stringify(data, null, 2));
        });

        ftp.setDebugMode(true);

        ftp.ls('gds/specials/warnings/xml/' + adapter.config.dienststelle, function(err, res) {
            if (err) {
                adapter.log.info('ftp ls error');
                stop();
            } else {
                for (var i = 0; i < res.length; i++) {
                    if (res[i].name.match(new RegExp(adapter.config.kreis + '\.xml$'))) {
                        files.push(res[i].name);
                    }
                }
                getFile(0);
            }
        });
    },

    unload: function (callback) {
        callback();
    }

});


function getFile(i) {
    if (!i) i = 0;
    if (!files[i]) {
        received();
        return;
    }
    adapter.log.info('getFile ' + files[i]);

    ftp.get('gds/specials/warnings/xml/' + adapter.config.dienststelle + '/' + files[i], function(err, socket) {
        if (err) {
            adapter.log.error('ftp get error');
            return;
        }
        var str = '';
        socket.on('data', function (d) {
            str += d.toString();
        });

        socket.on('close', function (hadErr) {
            if (hadErr) {
                adapter.log.error('error retrieving file');
                stop();
            } else {
                adapter.log.info('got weather warning');
            }
            xml[i] = str;
            setTimeout(function (c) {
                getFile(c);
            }, 1000, i + 1);
        });
        socket.resume();
    });
}

function received() {
    ftp.raw.quit();

    var warnungen = {};
    var now = formatTimestamp(new Date());

    for (var i = 0; i < xml.length; i++) {
        parseString(xml[i], {explicitArray: false}, function(err, res) {
            adapter.log.debug(res.alert.msgType+" "+res.alert.info.eventCode.value+" "+res.alert.info.event+" "+res.alert.info.severity+" "+res.alert.info.effective+" "+res.alert.info.expires);
            var effective = formatTimestamp(res.alert.info.effective),
                expires =   formatTimestamp(res.alert.info.expires);

            if (res.alert.msgType === 'Alert' && res.alert.info.eventCode.value > 30 && expires > now && effective < now) {
                warnungen[res.alert.info.eventCode.value] = {
                    text:       res.alert.info.event,
                    desc:       res.alert.info.description,
                    head:       res.alert.info.headline,
                    start:      effective,
                    expires:    expires,
                    severity:   res.alert.info.severity
                };
            }

            if (res.alert.msgType === 'Cancel') {
                if (warnungen[res.alert.info.eventCode.value]) {
                    delete(warnungen[res.alert.info.eventCode.value]);
                }
            }
        });

    }
    var warnung = {
        text: '',
        desc: '',
        head: '',
        start: '2037-01-01',
        expires: '0000-00-00',
        severity: 0
    };

    var first = true;
    for (var item in warnungen) {
        if (!first) {
            warnung.text += ', ';
            warnung.desc += ' ';
            warnung.head += ', ';
        } else {
            first = false;
        }
        if (warnung.expires < warnungen[item].expires)  warnung.expires =   warnungen[item].expires;
        if (warnung.start > warnungen[item].start)      warnung.start =     warnungen[item].start;
        warnung.text += warnungen[item].text;
        warnung.desc += warnungen[item].desc;
        warnung.head += warnungen[item].head;

        if (severity[warnungen[item].severity] > warnung.severity) warnung.severity = severity[warnungen[item].severity];

    }

    if (warnung.start === '2037-01-01')     warnung.start = '';
    if (warnung.expires === '0000-00-00')   warnung.expires = '';

    adapter.log.debug('warnung', warnung);
    adapter.log.info('setting states');
    adapter.setState('warning.begin',       {ack: true, val: warnung.start});
    adapter.setState('warning.end',         {ack: true, val: warnung.expires});
    adapter.setState('warning.severity',    {ack: true, val: warnung.severity});
    adapter.setState('warning.text',        {ack: true, val: warnung.text});
    adapter.setState('warning.headline',    {ack: true, val: warnung.head});
    adapter.setState('warning.description', {ack: true, val: warnung.desc});

    setTimeout(stop, 5000);

}


function formatTimestamp(str) {
    var ts = new Date(str);
    return ts.getFullYear() + '-' +
        ("0" + (ts.getMonth() + 1).toString(10)).slice(-2) + '-' +
        ("0" + (ts.getDate()).toString(10)).slice(-2) + ' ' +
        ("0" + (ts.getHours()).toString(10)).slice(-2) + ':' +
        ("0" + (ts.getMinutes()).toString(10)).slice(-2) + ':' +
        ("0" + (ts.getSeconds()).toString(10)).slice(-2);
}


setTimeout(function () {
    adapter.log.info("force terminating after 4 minutes");
    process.exit();
}, 240000);


