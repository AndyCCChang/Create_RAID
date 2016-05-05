(function(exports){
var HostStorage = function(hostIP) {

var nas_disk_progress_timer = null;
var page_refresh_timer = null;

function update_nas_disk_button_status() {
    var selectedCount = selectedItemsLength("#nas-disk-table");
    if (selectedCount > 0) {
        $("#nas-disk-destroy").prop("disabled", false);
    } else {
        $("#nas-disk-destroy").prop("disabled", true);
    }
}

function destroy_nas_disk() {
    if (confirm(getText("CONFIRM_DESTROY_NAS_DISK"))) {
        iterateSelectedItems("#nas-disk-table", function(last, disk, row) {
            ajax_host_nas_disk_destroy(hostIP, disk.idx, function(response) {
                if (last) {
                    host_storage_refresh_page();
                }
            });
        });
    }
}

function update_iscsi_session_button_status() {
    var selectedCount = selectedItemsLength("#iscsi-session-table");
    if (selectedCount > 0) {
        $("#iscsi-logout").prop("disabled", false);
    } else {
        $("#iscsi-logout").prop("disabled", true);
    }
}

function logout_iscsi_session() {
    if (confirm(getText("CONFIRM_CLOSE_SESSION"))) {
        iterateSelectedItems("#iscsi-session-table", function(last, session, row) {
            ajax_host_iscsi_logout('', hostIP, session.target, '', '', function(response) {
                if (last) {
                    host_storage_refresh_page();
                }
            });
        });
    }
}

function refresh_nas_disk_panel(recurrence, is_global) {
    var nas_disk_table = $("#nas-disk-table").dataTable();
    ajax_host_nas_disk_list(hostIP, function(response) {
        nas_disk_table.fnClearTable();
        var creating = false;
        if (response.length) {
            nas_disk_table.fnAddData(response);
            for (var i = 0; i < response.length; i++) {
                if ('progress' in response[i]) {
                    creating = true;
                    $('#nas-disk-create').prop('disabled', true);
                    $('#nas-disk-destroy').prop('disabled', true);
                    $('#nas-disk-progress').show();
                    var percentage = response[i].progress + '%';
                    $('#nas-disk-progress .progress-bar').css('width', percentage);
                    $('#nas-disk-progress .progress-bar').text(percentage);
                }
            }
        }
        if (creating) {
            if (!nas_disk_progress_timer || recurrence) {
                nas_disk_progress_timer = setTimeout(function() {
                    refresh_nas_disk_panel(true);
                }, 1);
            }
        } else {
            $('#nas-disk-create').prop('disabled', false);
            $('#nas-disk-destroy').prop('disabled', false);
            $('#nas-disk-progress').hide();
            nas_disk_progress_timer = null;
        }
    }, !recurrence && is_global);
}



function host_storage_refresh_page(initCompleted, recurrence) {
    //6.1 Create raid table
    var createRAIDTable = $("#create-raid-table").dataTable();
    var localDiskTable = $("#local-disk-table").dataTable();
    var iscsiDiskTable = $("#iscsi-disk-table").dataTable();
    var iscsiTable = $("#iscsi-session-table").dataTable();
    var is_controller = false;
    var is_global = !recurrence;

    if (initCompleted) {
        is_global = true;
    }

    $.when(ajax_host_feature_type(hostIP, null, is_global)
    ).then(function(resp) {
        is_controller = (resp.response.type == FEATURE_TYPE.CONTROLLER);
        if (is_controller) {
            $('#nas-disk-panel').show();
            $('#san-disk-panel').show();
            $('#iscsi-panel').show();

            // let nas disk panel update itself asynchronously
            refresh_nas_disk_panel(false, is_global);

            return $.when(ajax_host_local_disk_list(hostIP, null, is_global),
                          ajax_host_iscsi_disk_list(hostIP, null, is_global),
                          ajax_host_iscsi_list(hostIP, null, is_global),
                          ajax_disk_status_image(hostIP, null, is_global));
        } else {
            return $.when(ajax_host_local_disk_list(hostIP, null, is_global),
                          ajax_disk_status_image(hostIP, null, is_global),
                          ajax_host_create_raid_list(hostIP, null, is_global));
        }
    }).done(function(a, b, c, d){
        if (is_controller) {
            localDiskTable.fnClearTable();
            if (a[0].response.length) {
                localDiskTable.fnAddData(a[0].response);
            }
            iscsiDiskTable.fnClearTable();
            if (b[0].response.length) {
                iscsiDiskTable.fnAddData(b[0].response);
            }
            iscsiTable.fnClearTable();
            if (c[0].response.length) {
                iscsiTable.fnAddData(c[0].response);
            }
            if (d[0].response.length) {
                init_disk_images_table(d[0].response[0], d[0].response[1], d[0].response[2]);
            }
        } else {
            localDiskTable.fnClearTable();
            if (a[0].response.length) {
                localDiskTable.fnAddData(a[0].response);
            }
            if (b[0].response.length) {
                init_disk_images_table(b[0].response[0], b[0].response[1], b[0].response[2]);
            }
            createRAIDTable.fnClearTable();
            if (c[0].response.length) {
                createRAIDTable.fnAddData(c[0].response);
            }

        }
        if (initCompleted) {
            $("#content").show();
            initCompleted();
        }
        if (recurrence == true) {
            page_refresh_timer = setTimeout(function() {
                    host_storage_refresh_page(null, true);
            }, 100000);
        }
    });
}

function init_iscsi_session_table() {
    $("#iscsi-session-table").dataTable({
        "aoColumns": [
            {
                "bSortable": false,
                "sClass": "iscsi-check center",
                "sWidth": "5%",
                "mData": null,
                "mRender": function(data, type, full) {
                    return '<input type="checkbox"></input>';
                }
            },
            {
                "sTitle": getText("ADDRESS"),
                "sClass": "iscsi-address",
                "sWidth": "30%",
                "mData": "address"
            },
            {
                "sTitle": getText("TARGET"),
                "sClass": "iscsi-target",
                "sWidth": "65%",
                "mData": "target"
            }
        ],
        "fnDrawCallback": function(oSettings) {
            update_iscsi_session_button_status();
            $(".iscsi-check").click(update_iscsi_session_button_status);
        },
        "bAutoWidth": false,
        "aaSorting": [[ 1, "asc" ]],
        "oLanguage" : {
            "oPaginate": {
                "sFirst": getText("PAGE_FIRST"),
                "sLast": getText("PAGE_LAST"),
                "sNext": getText("PAGE_NEXT"),
                "sPrevious": getText("PAGE_PREVIOUS")
            },
            "sEmptyTable": getText("EMPTYTABLE"),
            "sInfo": getText("SHOWING_NUMBER_ENTRY"),
            "sInfoEmpty": getText("SHOWING_EMPTY"),
            "sInfoFiltered": getText("FILTER_TOTAL_ENTRY"),
            "sLengthMenu": getText("SHOW_MENU_ENTRIES"),
            "sSearch": getText("SEARCH"),
            "sZeroRecords": getText("SEARCH_NOMATCH")
        }
    });
}

function init_disk_images_table(rows, cols, slots) {
    blue = "<img src=\"images/disk_blue.png\">";
    red = "<img src=\"images/disk_red.png\">";
    if (rows == 0 && cols == 0) {
        $("#disk-array-panel").hide();
        return;
    }
    $("#disk-images-table tr").remove()
    var diskTable = $("#disk-images-table");
    var tr = [];
    var slot_index = 1
    for (var i = 0; i < rows; i++) {
        //var row = $('<tr></tr>').attr({ class: ["class1", "class2", "class3"].join(' ') }).appendTo(diskTable);
        var row = $('<tr></tr>').attr({}).appendTo(diskTable);
        for (var j = 0; j < cols; j++) {
            if ($.inArray(slot_index, slots) >= 0)
                $('<td></td>').html(blue).appendTo(row);
            else
                $('<td></td>').html(red).appendTo(row);
            slot_index += 1;
        }
    }
}
//v6.1 init_create_raid_table
function init_create_raid_table(){
    $("#create-raid-table").dataTable({
	"aoColumns": [
           {
               "sTitle": getText("Storage Box"),
               "sClass": "storage-box",
               "mData": "storage_box"
           },
           {
               "sTitle": getText("RAID"),
               "sClass": "raid-config",
               "sWidth": "100%",
               "mData": "raidconfig"
           },
           {
                "bSortable": false,
                "sTitle": getText("Create"),
                "sClass": "raid-check-create center",
                "sWidth": "5%",
                "mData": null,
                "mRender": function(data, type, full) {
                    if (data.r_status == "Created"){
                        return '<input type="checkbox" disabled></input>';
                    }
                    else {
                        return '<input type="checkbox"></input>';
                    }
                    return '<input type="checkbox"  id="create_raid"></input>';
               }
           },
           { 
                "bSortable": false,
                "sTitle": getText("Erase"),
                "sClass": "raid-check-erase center",
                "sWidth": "5%",
                "mData": null,
                "mRender": function(data, type, full) {
                    if (data.r_status != "Created"){
                        return '<input type="checkbox" disabled></input>';
                    }
                    else {
                        return '<input type="checkbox"></input>';
                    }
               }
           },
           {
               "sTitle": getText("Status"),
               "sClass": "raid-status",
               "mData": "r_status"
	   },
           {
               "sTitle": getText("Description"),
               "sClass": "raid-description",
               "mData": "r_description"
	   }
        ],
        "fnDrawCallback": function(oSettings) {
             update_confirm_button_status();
             $(".raid-check-erase").click(update_confirm_button_status);
             $(".raid-check-create").click(update_confirm_button_status);
        },
        "aaSorting": [[ 1, "asc" ]],
        "oLanguage" : {
            "oPaginate": {
                "sFirst": getText("PAGE_FIRST"),
                "sLast": getText("PAGE_LAST"),
                "sNext": getText("PAGE_NEXT"),
                "sPrevious": getText("PAGE_PREVIOUS")
            },
            "sEmptyTable": getText("EMPTYTABLE"),
            "sInfo": getText("SHOWING_NUMBER_ENTRY"),
            "sInfoEmpty": getText("SHOWING_EMPTY"),
            "sInfoFiltered": getText("FILTER_TOTAL_ENTRY"),
            "sLengthMenu": getText("SHOW_MENU_ENTRIES"),
            "sSearch": getText("SEARCH"),
            "sZeroRecords": getText("SEARCH_NOMATCH")
        }
    });
}

function init_local_disk_table() {
    $("#local-disk-table").dataTable({
        "aoColumns": [
            {
                "sTitle": getText("DISK_NAME"),
                "sClass": "disk-name",
                "mData": "name"
            },
            {
                "sTitle": getText("DISK_SIZE"),
                "sClass": "disk-size",
                "mData": function(source, type, val) {
                    if (type == 'set') {
                        source.size = val.size;
                        return;
                    } else if (type == undefined) {
                        if (source) {
                            return source;
                        } else {
                            return null;
                        }
                    } else {
                        return source.size;
                    }
                }
            },
            {
                "sTitle": getText("DISK_STATE"),
                "sClass": "disk-state",
                "mData": function(source, type, val) {
                    if (type == 'set') {
                        source.state = val.state;
                        return;
                    } else if (type == undefined) {
                        if (source) {
                            return source;
                        } else {
                            return null;
                        }
                    } else {
                        if (source.state) {
                            return source.state;
                        }
                        return '';
                    }
                }
            },
            {
                "sTitle": getText("DISK_SLOT"),
                "sClass": "disk-slot",
                "mData": "slot"
            },
            {
                "sTitle": getText("DISK_ERROR"),
                "sClass": "disk-error",
                "mData": function(source, type, val) {
                    if (type == 'set') {
                        source.error = val.error;
                        return;
                    } else if (type == undefined) {
                        if (source) {
                            return source;
                        } else {
                            return null;
                        }
                    } else {
                        if (source.error !== undefined) {
                            return source.error;
                        }
                        return '';
                    }
                }
            },
            {
                "sTitle": getText("FOREIGN_STATE"),
                "sClass": "disk-state",
                "mData": "foreign"
            },
            {
                "sTitle": getText("DEV_SPEED"),
                "sClass": "dev-speed",
                "mData": "dev_speed"
            },
            {
                "sTitle": getText("LINK_SPEED"),
                "sClass": "link-speed",
                "mData": "link_speed"
            },
            {
                "sTitle": getText("SMART_ERROR"),
                "sClass": "smart-error",
                "mData": "smart_error"
            }
        ],
        "aaSorting": [[ 1, "asc" ]],
        "oLanguage" : {
            "oPaginate": {
                "sFirst": getText("PAGE_FIRST"),
                "sLast": getText("PAGE_LAST"),
                "sNext": getText("PAGE_NEXT"),
                "sPrevious": getText("PAGE_PREVIOUS")
            },
            "sEmptyTable": getText("EMPTYTABLE"),
            "sInfo": getText("SHOWING_NUMBER_ENTRY"),
            "sInfoEmpty": getText("SHOWING_EMPTY"),
            "sInfoFiltered": getText("FILTER_TOTAL_ENTRY"),
            "sLengthMenu": getText("SHOW_MENU_ENTRIES"),
            "sSearch": getText("SEARCH"),
            "sZeroRecords": getText("SEARCH_NOMATCH")
        }
    });
}

function init_iscsi_disk_table() {
    $("#iscsi-disk-table").dataTable({
        "aoColumns": [
            {
                "sTitle": getText("TYPE"),
                "sClass": "disk-type",
                "mData": "slaves",
                "mRender": function(slaves, type, full) {
                    return slaves !== undefined ? slaves[0].type : full.type;
                }
            },
            {
                "sTitle": getText("DEVICE_PATH"),
                "sClass": "disk-path",
                "mData": "path"
            },
            {
                "sTitle": getText("DISK_SIZE"),
                "sClass": "disk-size",
                "mData": "size",
                "mRender": function(size, type, full) {
                    return Humanize.fileSize(size);
                }
            },
            {
                "sTitle": getText("TARGET"),
                "sClass": "disk-target",
                "mData": "slaves",
                "mRender": function(slaves, type, full) {
                    return slaves !== undefined ? slaves[0].target : full.target;
                }
            },
            {
                "sTitle": getText("LUN"),
                "sClass": "disk-lun",
                "mData": "slaves",
                "mRender": function(slaves, type, full) {
                    if (slaves !== undefined)
                        if (slaves[0].lun !== undefined)
                            return slaves[0].lun;
                    return full.lun;
                }
            },
            {
                "sTitle": getText("DISK_STATE"),
                "sClass": "disk-state",
                "mData": "online",
                "mRender": function(online, type, full) {
                    if (online === undefined) {
                        return ''
                    } else if (online) {
                        return '<img src="images/GreenDot.png"></img>';
                    } else {
                        return '<img src="images/RedDot.png"></img>';
                    }
                }
            },
            {
                "sTitle": getText("IO_COUNT_PER_SECOND"),
                "sClass": "disk-iops",
                "mData": "metrics",
                "mRender": function(metrics, type, full) {
                    return metrics['iops'];
                }
            },
            {
                "sTitle": getText("READ_THROUGHPUT"),
                "sClass": "disk-read-sec",
                "mData": "metrics",
                "mRender": function(metrics, type, full) {
                    return metrics['kb_read'] + 'kB/s';
                }
            },
            {
                "sTitle": getText("WRITE_THROUGHPUT"),
                "sClass": "disk-write-sec",
                "mData": "metrics",
                "mRender": function(metrics, type, full) {
                    return metrics['kb_write'] + 'kB/s';
                }
            }
        ],
        "aaSorting": [[ 1, "asc" ]],
        "oLanguage" : {
            "oPaginate": {
                "sFirst": getText("PAGE_FIRST"),
                "sLast": getText("PAGE_LAST"),
                "sNext": getText("PAGE_NEXT"),
                "sPrevious": getText("PAGE_PREVIOUS")
            },
            "sEmptyTable": getText("EMPTYTABLE"),
            "sInfo": getText("SHOWING_NUMBER_ENTRY"),
            "sInfoEmpty": getText("SHOWING_EMPTY"),
            "sInfoFiltered": getText("FILTER_TOTAL_ENTRY"),
            "sLengthMenu": getText("SHOW_MENU_ENTRIES"),
            "sSearch": getText("SEARCH"),
            "sZeroRecords": getText("SEARCH_NOMATCH")
        }
    });
}

function init_nas_disk_table() {
    $("#nas-disk-table").dataTable({
        "aoColumns": [
            {
                "bSortable": false,
                "sClass": "nas-check center",
                "sWidth": "5%",
                "mData": null,
                "mRender": function(data, type, full) {
                    return '<input type="checkbox"></input>';
                }
            },
            {
                "sTitle": getText("TYPE"),
                "sClass": "nas-disk-type",
                "mData": "type"
            },
            {
                "sTitle": getText("NAS_SERVER"),
                "sClass": "nas-disk-server",
                "mData": "server"
            },
            {
                "sTitle": getText("NAS_PATH"),
                "sClass": "nas-disk-path",
                "mData": "path"
            },
            {
                "sTitle": getText("DEVICE_PATH"),
                "sClass": "nas-disk-devpath",
                "mData": "devpath",
                "mRender": function(devpath, type, full) {
                    if (devpath === "")
                        return getText("CREATING");
                    return devpath;
                }
            },
            {
                "sTitle": getText("DISK_SIZE"),
                "sClass": "nas-disk-size",
                "mData": function(source, type, val) {
                    if (type == 'set') {
                        source.size = val.size;
                        return;
                    } else if (type == undefined) {
                        if (source) {
                            return source;
                        } else {
                            return null;
                        }
                    } else {
                        return Humanize.fileSize(source.size);
                    }
                }
            },
        ],
        "fnDrawCallback": function(oSettings) {
            update_nas_disk_button_status();
            $(".nas-check").click(update_nas_disk_button_status);
        },
        "aaSorting": [[ 1, "asc" ]],
        "oLanguage" : {
            "oPaginate": {
                "sFirst": getText("PAGE_FIRST"),
                "sLast": getText("PAGE_LAST"),
                "sNext": getText("PAGE_NEXT"),
                "sPrevious": getText("PAGE_PREVIOUS")
            },
            "sEmptyTable": getText("EMPTYTABLE"),
            "sInfo": getText("SHOWING_NUMBER_ENTRY"),
            "sInfoEmpty": getText("SHOWING_EMPTY"),
            "sInfoFiltered": getText("FILTER_TOTAL_ENTRY"),
            "sLengthMenu": getText("SHOW_MENU_ENTRIES"),
            "sSearch": getText("SEARCH"),
            "sZeroRecords": getText("SEARCH_NOMATCH")
        }
    });
}

function nas_type_changed() {
    var nas_type = $("#nas-type-input").val();
    $("#nas-username-input").val("");
    $("#nas-password-input").val("");
    if (nas_type == "nfs") {
        $("#create-cifs-disk-notice").hide();
        $("#nas-username-input").prop("disabled", true);
        $("#nas-password-input").prop("disabled", true);
    } else {
        $("#create-cifs-disk-notice").show();
        $("#nas-username-input").prop("disabled", false);
        $("#nas-password-input").prop("disabled", false);
    }
}

this.init = function(initCompleted) {
    $('#nas-disk-panel').hide();
    $('#nas-disk-progress').hide();
    $('#san-disk-panel').hide();
    $('#iscsi-panel').hide();
    $("#nas-disk-destroy").click(destroy_nas_disk);
    $("#nas-type-input").on("change", nas_type_changed);
    $("#dialog-nas-disk-create").on("show.bs.modal", function(e) {
        $("#nas-type-input").val("nfs");
        $("#nas-server-input").val("");
        $("#nas-path-input").val("");
        $("#nas-size-input").val("");
        nas_type_changed();
    });
    $("#nas-disk-create-ok").click(function() {
        var type = $("#nas-type-input").val();
        var server = $("#nas-server-input").val();
        var path = $("#nas-path-input").val();
        var size = $("#nas-size-input").val();
        var username = $("#nas-username-input").val();
        var password = $("#nas-password-input").val();
        var res = validate_nas_disk_size(size);
        if (!res[0]) {
            alert(res[1]);
            return;
        }
        var disk_size = filesize_parser(size);

        ajax_host_nas_disk_create(hostIP, type, server, path, disk_size, username, password, function(response) {
            host_storage_refresh_page();
            $("#dialog-nas-disk-create").modal('hide');
        });
    });

    $("#iscsi-logout").click(logout_iscsi_session);

    function autocomplete_handler(request, response_cb) {
        if (!$("#server-ip-input").val() || !$("#server-port-input").val()) {
            response_cb([]);
            return;
        }

        ajax_host_iscsi_list_target(
            hostIP,
            $("#server-ip-input").val(),
            $("#server-port-input").val(),
            false)
        .then(
            function(reply){
                response_cb(reply.response);
            })
        .fail(
            function() {
                response_cb([]);
            }
        );
    }

    $("#target-name-input").autocomplete({source: autocomplete_handler});

    $("#dialog-iscsi-login").on("show.bs.modal", function(e) {
        $("#server-ip-input").val("");
        $("#server-port-input").val("3260");
        $("#target-name-input").val("");
    });
    $("#dialog-iscsi-login").on("shown.bs.modal", function(e) {
        $("#server-ip-input").focus();
    });
    $("#iscsi-login-ok").click(function() {
        var ip = $("#server-ip-input").val();
        var port = $("#server-port-input").val();
        var target = $("#target-name-input").val();
        ajax_host_iscsi_login('', hostIP, ip, port, target, function(response) {
            host_storage_refresh_page();
            $("#dialog-iscsi-login").modal('hide');
        });
    });
    $("#raid-create-confirm").click(function(){
        var storage_box;
        var storage_box_list = [];
        iterateSelectedItems("#create-raid-table", function(last, raid, row) {
            console.log("in iterateSelectedItems");
            console.log("raid.storage_box: " + raid.storage_box);
            storage_box = raid.storage_box;
            console.log("storage_box: " + storage_box);
            storage_box_list.push(raid.storage_box);
            ajax_create_raid(hostIP, storage_box_list, function(response){
                var raidTable = $("#create-raid-table").dataTable();
                console.log("before modal hide");
                host_storage_refresh_page();
                $("#dialog-create-raid").modal('hide');
                console.log("after modal hide");
            });
        });
    });

    $("#raid-erase-confirm").click(function(){
        var storage_box;
        var storage_box_list = [];
        iterateSelectedItems("#create-raid-table", function(last, raid, row) {
            console.log("in iterateSelectedItems");
            console.log("raid.storage_box: " + raid.storage_box);
            storage_box = raid.storage_box;
            console.log("storage_box: " + storage_box);
            storage_box_list.push(raid.storage_box);
            ajax_erase_raid(hostIP, storage_box_list, function(response){
                var raidTable = $("#create-raid-table").dataTable();
                console.log("before modal hide");
                host_storage_refresh_page();
                $("#dialog-create-raid").modal('hide');
                console.log("after modal hide");
            });
         });   
    });

    init_local_disk_table();
    init_iscsi_disk_table();
    init_nas_disk_table();
    init_iscsi_session_table();
    //v6.1 init_create_raid_table
    init_create_raid_table();
    host_storage_refresh_page(initCompleted, true);
}

this.uninit = function() {
    $.xhrPool.abortAll();
    clearTimeout(page_refresh_timer);
    clearTimeout(nas_disk_progress_timer);
    $("#local-disk-table").dataTable().fnDestroy();
    $("#create-raid-table").dataTable().fnDestroy();
    $("#iscsi-disk-table").dataTable().fnDestroy();
    $("#nas-disk-table").dataTable().fnDestroy();
    $("#iscsi-session-table").dataTable().fnDestroy();
    $("#content").remove();
}
//v6.1 update_confirm_button_status
function update_confirm_button_status(){
    $("#raid-create-confirm").prop("disabled", true);
    $("#raid-erase-confirm").prop("disabled", true);
    if (selectedForthItemsLength("#create-raid-table") > 0){
        $("#raid-erase-confirm").prop("disabled", false);
    }
    if (selectedThirdItemsLength("#create-raid-table") > 0){
        $("#raid-create-confirm").prop("disabled", false);
    }
}



};
exports.HostStorage = HostStorage;
}(window));
