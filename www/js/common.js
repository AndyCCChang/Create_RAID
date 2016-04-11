var gAPIErrorCode = {};
var gAPIErrorMessage = [];
var gMaxBandwidthLowerBound = 0;
var gMaxIOPSLowerBound = 0;
var notification_message = {};
var g_component_class = null;

var ROLE_STATE = {
    "-1": "UNKNOWN",
    "0": "DISABLED",
    "1": "ENABLING",
    "2": "ENABLED",
    "3": "DISABLING",
    "4": "DISABLE_FAIL",
    "5": "ENABLE_FAIL"
};

var FEATURE_TYPE = {
    CONTROLLER: 'controller',
    SCALER: 'scaler'
};

// implement Object.create for IE 7 & 8
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/create#Polyfill
if (typeof Object.create != 'function') {
    Object.create = (function() {
        var Temp = function() {};
        return function (prototype) {
            if (arguments.length > 1) {
                throw Error('Second argument not supported');
            }
            if (typeof prototype != 'object') {
                throw TypeError('Argument must be an object');
            }
            Temp.prototype = prototype;
            var result = new Temp();
            Temp.prototype = null;
            return result;
        };
    })();
}

jQuery.extend( jQuery.fn.dataTableExt.oSort, {
    "title-numeric-pre": function ( a ) {
        var x = a.match(/title="*(-?[0-9\.]+)"/);
        if (x) {
            return parseFloat(x[1]);
        } else {
            return 0;
        }
    },

    "title-numeric-asc": function ( a, b ) {
        return ((a < b) ? -1 : ((a > b) ? 1 : 0));
    },

    "title-numeric-desc": function ( a, b ) {
        return ((a < b) ? 1 : ((a > b) ? -1 : 0));
    },

    "title-string-pre": function ( a ) {
        var x = a.match(/title="(.*?)"/);
        if (x) {
            return x[1].toLowerCase();
        } else {
            return "";
        }
    },

    "title-string-asc": function ( a, b ) {
        return ((a < b) ? -1 : ((a > b) ? 1 : 0));
    },

    "title-string-desc": function ( a, b ) {
        return ((a < b) ? 1 : ((a > b) ? -1 : 0));
    }
} );

function zip(arrays) {
    return $.map(arrays[0], function(_,i){
                    return [$.map(arrays, function(array){return array[i]})];
                        });
}

function goto_vs_page(name) {
    g_dashboard.open_vstorage_tab(name, 0);
}

function goto_host_page(ip) {
    g_dashboard.open_host_tab(ip, 0);
}

function htmlEscape(str) {
    return String(str)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
}

function trimAll(sString) {
    while (sString.substring(0, 1) == ' ') {
        sString = sString.substring(1, sString.length);
    }
    while (sString.substring(sString.length - 1, sString.length) == ' ') {
        sString = sString.substring(0, sString.length - 1);
    }
    return sString;
}

function load_notification_messages(notification_messages, user_lang) {
    $.ajax({
        cache: false,
        url: "L10N/notification-" + user_lang + ".json",
        dataType: "json",
        async: false,
        success: function(messages) {
            $.each(messages, function(k1, v1) {
                if (typeof v1 == "object") {
                    $.each(v1, function(k2, v2) {
                        notification_messages[k1 + "." + k2] = v2;
                    });
                } else {
                    notification_messages[k1] = v1;
                }
            });
        },
        error: function(jqXHR) {
            if (user_lang == "en") {
                alert(getText("LOAD_NOTIFICATION_MESSAGE_ERROR"));
            } else {
                load_notification_messages(notification_messages, "en");
            }
        }
    });
}

function loadL10NErrorMessages(APIErrorMessage, language) {
    $.ajax({
        cache: false,
        url: "L10N/api-" + language + ".json",
        dataType: "json",
        async: false,
        success: function(messages) {
            for (var index in APIErrorMessage) {
                if (APIErrorMessage[index]) {
                    var keys = APIErrorMessage[index].split(".");
                    var obj = messages;
                    for (var i = 0; i < keys.length; i++) {
                        obj = obj[keys[i]];
                    }
                    APIErrorMessage[index] = obj;
                }
            }
        },
        error: function(jqXHR) {
            if (language == "en") {
                alert(getText("LOAD_API_MESSAGE_ERROR"));
            } else {
                loadL10NErrorMessages(APIErrorMessage, "en");
            }
        }
    });
}

function loadAPIErrors(APIErrorCode, APIErrorMessage) {
    $.ajax({
        cache: false,
        url: "js/errors.json",
        dataType: "json",
        async: false,
        success: function(errors) {
            $.extend(APIErrorCode, errors);
            $.each(errors, function(k1, v1) {
                if (typeof v1 == "object") {
                    $.each(v1, function(k2, v2) {
                        APIErrorMessage[v2] = k1 + "." + k2;
                    });
                } else {
                    APIErrorMessage[v1] = k1;
                }
            });
            var userLang = navigator.language || navigator.userLanguage;
            userLang = userLang.replace(/_/, '-').toLowerCase();
            loadL10NErrorMessages(APIErrorMessage, userLang);
        },
        error: function(jqXHR) {
            alert(getText("LOAD_API_CODE_ERROR"));
        }
    });
}

function display_string(string, empty_text, max_len) {
    if (string.length == 0)
	return empty_text;
    else if (string.length <= max_len)
	return string;
    else
	return string.substring(0, max_len - 3) + '...';
}

function clearSelectedItems(tableSelector) {
    var table = $(tableSelector).dataTable();
    table.$("tr").each(function() {
        $(this).find("td:first-child input").prop("checked", false);
    });
}

function iterateSelectedBothItems(tableSelector, callback) {
    var count = 0;
    var total = selectedItemsLength(tableSelector);
    iterate_both_items(tableSelector, function(last, checked, item, row) {
        if (checked) {
            if (callback) {
                callback(++count==total, item, row);
            }
        }
    });
}
//andy
function iterate_both_items(tableSelector, callback){
    var total = items_length(tableSelector);
    var table = $(tableSelector).dataTable();
    var count = 0;
    table.$("tr").each(function() {
        var row = this;
        var item = table.fnGetData(this);
        if ($(this).find("td:nth-child(3) input").prop("checked") || $(this).find("td:nth-child(4) input").prop("checked") ) {
        //    $(this).find("td:nth-child(4) input").prop("disabled", true);
        //if ($(this).find("td:nth-child(3) input").prop("checked")) {
            if (callback) {
                if (++count == total) {
                    callback(true, true, item, row);
                } else {
                    callback(false, true, item, row);
                }
            }
        }
        else {
            if (callback) {
                if (++count == total) {
                    callback(true, false, item, row);
                } else {
                    callback(false, false, item, row);
                }
            }
        }
    });
}

function iterate_items(tableSelector, callback) {
    var total = items_length(tableSelector);
    var table = $(tableSelector).dataTable();
    var count = 0;
    table.$("tr").each(function() {
        var row = this;
        var item = table.fnGetData(this);
        if ($(this).find("td:first-child input").prop("checked") || $(this).find("td:nth-child(3) input").prop("checked") || $(this).find("td:nth-child(4) input").prop("checked") ) {
        //if ($(this).find("td:nth-child(3) input").prop("checked")) {
            if (callback) {
                if (++count == total) {
                    callback(true, true, item, row);
                } else {
                    callback(false, true, item, row);
                }
            }
        }
        else {
            if (callback) {
                if (++count == total) {
                    callback(true, false, item, row);
                } else {
                    callback(false, false, item, row);
                }
            }
        }
    });
}

function iterateUnselectedItems(tableSelector, callback) {
    var count = 0;
    var total = unselectedItemsLength(tableSelector);
    iterate_items(tableSelector, function(last, checked, item, row) {
        if (!checked) {
            if (callback) {
                callback(++count==total, item, row);
            }
        }
    });
}
var iterate_unselected_items = iterateUnselectedItems; // for naming convension

//Andy
//function iterateSelectedItemsRAID(tableSelector, operation, callback) {
//    var count = 0;
//    var total = selectedItemsLength(tableSelector);
//    if (operation == "CREATE"){
//        iterate_items(tableSelector, function(last, checked, item, row) {
//            if (checked) {
//                if (callback) {
//                    callback(++count==total, item, row);
//                }
//            }
//       });
//    }
//    else if (operation == "ERASE"){
    
//    }
//}

//Andy iterate Selected Forth Items
function iterateSelectedForthItems(tableSelector, callback) {
    var count = 0;
    var total = selectedForthItemsLength(tableSelector);
    iterate_items(tableSelector, function(last, checked, item, row) {
        if (checked) {
            if (callback) {
                callback(++count==total, item, row);
            }
        }
    });
}
//Andy iterate Selected Third Items
function iterateSelectedThirdItems(tableSelector, callback) {
    var count = 0;
    var total = selectedThirdItemsLength(tableSelector);
    iterate_items(tableSelector, function(last, checked, item, row) {
        if (checked) {
            if (callback) {
                callback(++count==total, item, row);
            }
        }
    });
}
function iterateSelectedItems(tableSelector, callback) {
    var count = 0;
    var total = selectedItemsLength(tableSelector);
    iterate_items(tableSelector, function(last, checked, item, row) {
        if (checked) {
            if (callback) {
                callback(++count==total, item, row);
            }
        }
    });
}
var iterate_selected_items = iterateSelectedItems;  // for naming convension

function items_length(tableSelector) {
    var table = $(tableSelector).dataTable();
    return table.$("tr").length;
}
//Andy selected 4th column
function selectedForthItemsLength(tableSelector) {
    var count = 0;
    var table = $(tableSelector).dataTable();
    table.$("tr").each(function() {
        if ($(this).find("td:nth-child(4) input").prop("checked")) {
            count++;
        }
    });
    return count;
}
//Andy selected 3rd column
function selectedThirdItemsLength(tableSelector) {
    var count = 0;
    var table = $(tableSelector).dataTable();
    table.$("tr").each(function() {
        if ($(this).find("td:nth-child(3) input").prop("checked")) {
            count++;
        }
    });
    return count;
}

function selectedItemsLength(tableSelector) {
    var count = 0;
    var table = $(tableSelector).dataTable();
    table.$("tr").each(function() {
        if ($(this).find("td:first-child input").prop("checked")) {
            count++;
        }
    });
    return count;
}

function unselectedItemsLength(tableSelector) {
    var count = 0;
    var table = $(tableSelector).dataTable();
    table.$("tr").each(function() {
        if (!$(this).find("td:first-child input").prop("checked")) {
            count++;
        }
    });
    return count;
}

function inEditMode(tableSelector) {
    return $(tableSelector + " td form input[name=value]").length > 0 ? true : false;
}

function get_text_nodes(elem) {
    var nodes = elem.contents().filter(function() {
        return this.nodeType === 3;
    });
    return $.map(nodes, function(node, i) {
        return node.nodeValue;
    });
}

function osd_disk_usage_html(osd_used, osd_total) {
    var usedPercentage = (Number(osd_used) / Number(osd_total)) * 100;
    var grandparent = $('<div>');
    var parent = $('<div>');
    parent.addClass('progress');
    parent.attr('title', sprintf("%s%s, %s %s, %s %s", usedPercentage.toFixed(2), getText('%_USED'), Humanize.fileSize(Number(osd_used)*1024), getText("BYTES_USED"), Humanize.fileSize(Number(osd_total)*1024), getText("BYTES_TOTLE")));
    var elem = $('<div>');
    elem.addClass('progress-bar');
    elem.attr('role',  'progressbar');
    elem.attr('aria-valuenow', Math.round(usedPercentage));
    elem.attr('aria-valuemin', 0);
    elem.attr('aria-valuemax', 100);
    elem.css('width', Math.round(usedPercentage)+'%');
    parent.append(elem);
    grandparent.append(parent);
    return grandparent.html();
}

function common_init() {

    Highcharts.setOptions({global:{useUTC: false}});

    $(document).ajaxStart(function() {
        spinner =  new Spinner().spin($("body")[0]);
        $(spinner.el).css('position', 'fixed');
    });

    $(document).ajaxStop(function() {
        spinner.stop();
    });

    g_translator.translate_element_tree($(document));

    $("#account-nav-button").text($.cookie('login_id')).append('<span class="caret" style="margin-left:5px;"></span>');

    $("#change-password-nav-button").click(function() {
        $("#dialog-change-password").modal('show');
    });

    $('#logout-nav-button').click(function() {
        ajax_logout(function(response) {
            $('.sidebar').children().remove();
            $('.main').children().remove();
            $('#dialog-login').modal('show');
        });
    });

    $("#dialog-login").on("shown.bs.modal", function(e) {
        $("#login_id_input").focus();
    });
    $("#login-ok").click(function() {
        ajax_login(
            $("#login_id_input").val(),
            $("#password_input").val(),
            function(response) {
                $("#dialog-login").modal('hide');
                location.reload(true);
            }
        );
    });

    $("#dialog-change-password").on("shown.bs.modal", function(e) {
        $("#old_password_input").focus();
    });
    $("#change-password-ok").click(function() {
        ajax_change_password(
            $("#old_password_input").val(),
            $("#new_password_input").val(),
            $("#confirm_password_input").val(),
            function(response) {
                alert(getText("SUCCESS_CHANGE_PASSWORD"));
                $("#dialog-change-password").modal('hide');
            }
        );
    });

    $(document).keydown(function(e) {
        if (e.which == 13) {
            // click primary button of the top-most dialog
            $('.modal.fade.in').last().find('.modal-footer,.wizard-footer').find('.btn-primary,.btn-success').click();
        }
    });

    loadAPIErrors(gAPIErrorCode, gAPIErrorMessage);
    var userLang = navigator.language || navigator.userLanguage;
    userLang = userLang.replace(/_/, '-').toLowerCase();
    load_notification_messages(notification_message, userLang);

    ajax_get_qos_lowerbounds(function(response) {
        gMaxBandwidthLowerBound = response.lb_maxbw;
        gMaxIOPSLowerBound = response.lb_maxiops;
    });
}

function get_hash_parameters(hashString) {
    var params = {};
    var start_from = 1;
    if (hashString.indexOf("#/") == 0)
        start_from = 2;

    var pairs = hashString.substr(start_from).split('&');
    $.each(pairs, function(i, pair) {
        var kv = pair.split('=');
        if (kv.length != 2) return;
        params[kv[0]] = decodeURIComponent(kv[1].replace(/\+/g, " "));
    });
    return params;
}

function register_component_class(component_class) {
    g_component_class = component_class;
}

function load_components(elem, done_cb) {
    // avoid loading tabs of tab controllers
    if (this instanceof TabsController) {
        done_cb();
        return;
    }

    if (!elem)
        throw new Error("elem is not specified");

    var self = this;
    var deferreds = [];
    elem.find("[data-src-html]").each(function(index) {
        var deferred = new $.Deferred();
        var root_div = $(this);
        root_div.hide();
        root_div.load(root_div.data('src-html'), function() {
            if (self instanceof BaseComponent) {
                if (g_component_class) {
                    var component = new g_component_class(root_div);
                    if (typeof component.set_delegate == 'function') {
                        component.set_delegate(self);
                    }
                    self.sub_components.push(component);
                    g_component_class = null;
                } else {
                    root_div.show();
                }
            } else {
                root_div.show();
            }
            g_translator.translate_element_tree(root_div);
            deferred.resolve();
        });
        deferreds.push(deferred);
    });
    $.when.apply(null, deferreds).done(done_cb);
}

function assert_methods(obj /*, method list as strings */) {
    var i = 1;
    var method_name;
    while ((method_name = arguments[i++])) {
        if (typeof obj[method_name] != 'function') {
            $.error('method ' + method_name + ' is not implemented');
        }
    }
}

function bool_to_yesno(test) {
    if (test)
	return getText("YES");
    else
	return getText("NO");
}

function get_or_create_highchart(container, options) {
    var chart = container.highcharts();
    if (!chart) {
        // keep original options unmodified
        container.highcharts($.extend(true, {}, options));
        container.children().css('margin', 'auto');
        chart = container.highcharts();
    }
    return chart;
}

function update_realtime_highchart(chart, series_points, options) {
    var xaxis_min_range = options.xaxis_min_range;  // required
    var thresholds = options.thresholds;  // optional
    var redraw = true;
    if (options.redraw !== undefined)
        redraw = options.redraw;
    for (var i = 0; i < series_points.length; i++) {
        var point = series_points[i];
        if (chart.series[i].data.length > 0 &&
            point.x - chart.series[i].data[0].x >= xaxis_min_range) {
            chart.series[i].addPoint([point.x, point.y], redraw, true, false);
            // let highchart calculate x-axis min
            chart.xAxis[0].update({min: null});
        } else {
            // set x-min when drawing the first data point
            if (chart.series[i].data.length === 0) {
                chart.xAxis[0].update({min: point.x});
            }
            chart.series[i].addPoint([point.x, point.y], redraw, false, false);
        }
        if (thresholds) {
            if (point.y > thresholds[i])
                chart.series[i].update({color:'#F45B5B'});
            else if (point.y > thresholds[i] * 0.8)
                chart.series[i].update({color:'#F0AD4E'});
            else
                chart.series[i].update({color:'#7CB5EC'});
        }
    }
}

function get_light_img_elem(on, healthy) {
    var img = $('<img>');
    if (on) {
        if (healthy) {
            img.attr('src', 'images/GreenDot.png');
        } else {
            img.attr('src', 'images/RedDot.png');
        }
    } else {
        img.attr('src', 'images/GrayDot.png');
    }
    return img;
}

function get_megacli_output_link(ip) {
    var link = $('<a>');
    link.attr('href', sprintf('https://%s:8080/megaraid.output', ip));
    link.attr('target', '_blank');
    return link;
}

function get_smartctl_output_link(ip) {
    var link = $('<a>');
    link.attr('href', sprintf('https://%s:8080/smartctl.output', ip));
    link.attr('target', '_blank');
    return link;
}

function get_df_progress_bar(used, total) {
    var used_percentage = (Number(used) / Number(total)) * 100;
    var progress = $('<div>');
    progress.addClass('progress-bar');
    if (used_percentage > 90) {
        progress.addClass('progress-bar-danger');
    } else if (used_percentage > 80) {
        progress.addClass('progress-bar-warning');
    }
    progress.attr('role',  'progressbar');
    progress.attr('aria-valuenow', Math.round(used_percentage));
    progress.attr('aria-valuemin', 0);
    progress.attr('aria-valuemax', 100);
    progress.css('width', Math.round(used_percentage)+'%');
    return progress;
}

function qos_value_string(value_str) {
    if (value_str === '')
        return getText('UNLIMITED');
    else
        return value_str;
}

function qos_value(value_str) {
    if (value_str === '')
        return '0';
    else
        return value_str;
}

function convert_statistic_interval_to_resolution_and_range(interval) {
    var BY_MIN = 60;
    var BY_HOUR = 60 * 60;
    var BY_DAY = 60 * 60 * 24;

    switch(interval) {
        case 'last_24_hours':
            return { resolution: BY_MIN, range: 24 * 60 };
        case 'last_7_days':
            return { resolution: BY_HOUR, range: 7 * 24 };
        case 'last_30_days':
            return { resolution: BY_HOUR, range: 30 * 24 };
        case '1_year':
            return { resolution: BY_DAY, range: 365 };
        case '3_years':
            return { resolution: BY_DAY, range: 3 * 365 };
        default:
            return null;
    }
}

function toggleChecks(obj)
{
    $('.allUser').prop('checked', obj.checked);
}

function get_date() {
    var d = new Date();
    var month = d.getMonth()+1;
    var day = d.getDate();
    var hour = d.getHours();
    var minute = d.getMinutes();
    var second = d.getSeconds();

    var output = d.getFullYear() +
        (month<10 ? '0' : '') + month +
        (day<10 ? '0' : '') + day +
        (hour<10 ? '0' : '') + hour +
        (minute<10 ? '0' : '') + minute +
        (second<10 ? '0' : '') + second;
    return output;
}

