(function(exports){
var HostRoles = function(hostIP) {

var STORAGE_VOLUME_TYPE = {
    "0": "SINGLE_PARTITION",
    "1": "SINGLE_PARTITION",
    "2": "STRIPED",
    "3": "SOFTWARE_RAID"
};
var ADD_VOLUME_MODE = {
    SINGLE_PARTITION: "single",
    SINGLE_PARTITION_BATCH: "single_batch",
    STRIPED: "striped",
    SOFTWARE_RAID: "raidz"
};
var STORAGE_VOLUME_STATE = {
    INIT: "INIT",               // init state
    ONLINE: "ONLINE",           // an osd uses it
    OFFLINE: "OFFLINE",         // no osd uses it
    SCANNING: "SCANNING",       // under fscking
    REFORMATING: "REFORMATING", // under reformating
    ENABLING: "ENABLING",       // binding an osd to it
    DISABLING: "DISABLING",     // unbinding its osd
    ENABLE_FAILED: "ENABLE_FAILED",
    DISABLE_FAILED: "DISABLE_FAILED",
    ONLINE_FAILED: "ONLINE_FAILED",
    OFFLINE_FAILED: "OFFLINE_FAILED",
    DEGRADED: "DEGRADED"
};
var INTERFACE_ROLE = {
    STORAGE: "storage",
    PUBLIC: "public",
    CLUSTER: "cluster"
};
var refreshTimer = null;
var osdProgressTimer = null;
var gwProgressTimer = null;
var rrsProgressTimer = null;
var g_partition_list = null;

function update_storage_volume_button_status() {
    $("#delete-storage-volume").prop("disabled", true);
    $("#edit-storage-volume").prop("disabled", true);
    $("#repair-storage-volume").prop("disabled", true);
    $("#enable-osd").prop("disabled", true);
    $("#disable-osd").prop("disabled", true);
    $("#setup-rackid").prop("disabled", true);

    ajax_get_rack_aware_status(function(response) {
        var use_rack_replica = response.use_rack_replica;
        var rack_id = response.rack_id;
        if (use_rack_replica == "yes" && rack_id == "") {
            $("#setup-rackid").prop("disabled", false);
            $("#add-storage-volume").prop("disabled", true);
        } else {
            $("#setup-rackid").prop("disabled", true);
            $("#add-storage-volume").prop("disabled", false);
        }
    });

    var select_one = true;
    iterate_selected_items('#storage-volume-table', function(last, vol, row) {
        if (select_one && !last)
            select_one = false;
        switch (vol.state) {
            case STORAGE_VOLUME_STATE.ONLINE:
                if (select_one)
                    $("#edit-storage-volume").prop("disabled", false);
            case STORAGE_VOLUME_STATE.ONLINE_FAILED:
                $("#repair-storage-volume").prop("disabled", false);
            case STORAGE_VOLUME_STATE.DISABLE_FAILED:
            case STORAGE_VOLUME_STATE.ENABLE_FAILED:
                $("#disable-osd").prop("disabled", false);
                break;
            case STORAGE_VOLUME_STATE.OFFLINE:
                if (select_one)
                    $("#edit-storage-volume").prop("disabled", false);
                $("#enable-osd").prop("disabled", false);
            case STORAGE_VOLUME_STATE.OFFLINE_FAILED:
                $("#delete-storage-volume").prop("disabled", false);
                break;
            case STORAGE_VOLUME_STATE.DEGRADED:
                // we hope user fix degraded storage volumes asap,
                // so forbiding all operations might be ok.
                break;
            default:
                break;
        }
    });
}

function update_san_volume_cache_button_status() {
    var selectedCount = selectedItemsLength("#san-volume-cache-table");
    if (selectedCount > 0) {
        $("#delete-san-volume-cache").prop("disabled", false);
    } else {
        $("#delete-san-volume-cache").prop("disabled", true);
    }
}

function partition_path(partition) {
    if (partition.path.indexOf('/dev/dm') === 0)
        return sprintf('%s (part%d)', partition.path, partition.number);
    else
        return partition.path
    // var regexp = /^[.]+[\d]+$/;
    // if (regexp.test(disk.path)) {
    //     return disk.path + "p" + partition.number;  // ex. /dev/md0p1
    // } else {
    //     return disk.path + partition.number;  // ex. /dev/sdc1
    // }
}

// the opposite function of in_selected_disks
// a path contains the selected disks/partitions if and only if
// at least one of the selected disks/partitions is in the path
function contains_selected_disks(path, selectedDisks) {
    if (selectedDisks) {
        if ($.isArray(selectedDisks)) {
            for (var i = 0; i < selectedDisks.length; i++) {
                if (in_selected_disks(selectedDisks[i], path)) {
                    return true;
                }
            }
        } else {
            return in_selected_disks(selectedDisks, path);
        }
    }
    return false;
}

// in order to change current used partitions of a storage volume,
// we need to allow the used partition being selectable (= mark them unused)
// and if the unmarked partition is the only used partition of its disk,
// we also need to unmark the disk.
function unmark_used_disk(unmarkDisk, disks) {
    if (!unmarkDisk || unmarkDisk.length === 0) {
        return;
    }
    $.each(disks, function(index, disk) {
        // MPIO physical device is always used
        var foundUsedPartition = disk.mpio_physical ? true: false;
        $.each(disk.partitions, function(index, partition) {
            if (partition.used) {
                if ($.isArray(unmarkDisk)) {
                    $.each(unmarkDisk, function(index, ud) {
                        if (partition.path == ud) {
                            partition.used = false;
                        } else {
                            foundUsedPartition = true;
                        }
                    });
                } else {
                    if (partition.path == unmarkDisk) {
                        partition.used = false;
                    } else {
                        foundUsedPartition = true;
                    }
                }
            }
        });
        if (disk.used && !foundUsedPartition) {
            disk.used = false;
        }
    });
}

function propagate_data_partition_list(list, disks, mode) {
    var optgroups = [];
    $.each(disks, function(index, disk) {
        var optgroup = {
            label: "",
            children: []
        };
        if (!disk.used) {
            optgroup.children.push({
                label: sprintf("%s %sM", disk.path, disk.size_mb),
                value: disk.path
            });
        }
        if (mode != ADD_VOLUME_MODE.SINGLE_PARTITION_BATCH) {
            $.each(disk.partitions, function(index, partition) {
                if (!partition.used) {
                    optgroup.children.push({
                        label: sprintf("%s %sM", partition_path(partition), partition.size_mb),
                        value: partition.path
                    });
                }
            });
        }
        if (optgroup.children.length > 0) {
            if (disk.type =='mpath')
                optgroup.label = sprintf("%s ( %s %s )", disk.path, disk.slaves[0].vendor, disk.slaves[0].model);
            else
                optgroup.label = sprintf("%s ( %s )", disk.path, disk.model);
            optgroups.push(optgroup);
        }
    });
    list.multiselect("dataprovider", optgroups);
}

function propagate_default_journal_partition_list(list, disks, selectedDefaultJournal) {
    var tempDisks = $.extend(true, {}, disks);
    unmark_used_disk(selectedDefaultJournal, tempDisks);
    var optgroups = [];
    $.each(tempDisks, function(index, disk) {
        var optgroup = {
            label: "",
            children: []
        };
        if (!disk.used) {
            optgroup.children.push({
                label: sprintf("%s %sM", disk.path, disk.size_mb),
                value: disk.path
            });
        }
        $.each(disk.partitions, function(index, partition) {
            // allow user selecting root partition to put default journal on
            if (!partition.used || partition.root) {
                optgroup.children.push({
                    label: sprintf("%s %sM", partition_path(partition), partition.size_mb),
                    value: partition.path
                });
            }
        });
        if (optgroup.children.length > 0) {
            if (disk.type =='mpath')
                optgroup.label = sprintf("%s ( %s %s )", disk.path, disk.slaves[0].vendor, disk.slaves[0].model);
            else
                optgroup.label = sprintf("%s ( %s )", disk.path, disk.model);
            optgroups.push(optgroup);
        }
    });
    list.multiselect("dataprovider", optgroups);
}

// check if the path is a disk/partition of selected disks/partitions
// a partition in a disk if the partition is located on the disk
// a disk in a disk if they are the same disk
// a partition in a partition if they are the same partition
// a disk cannot be in a partition by definition
function in_selected_disks(path, selectedDisks) {
    var all_disks = g_partition_list;
    if (selectedDisks) {
        for (var i = 0; i < all_disks.length; i++) {
            var disk = all_disks[i];
            // if path is disk, just check if the disk path is selected
            if (path == disk.path) {
                if ($.isArray(selectedDisks)) {
                    return ($.inArray(path, selectedDisks) != -1);
                } else {
                    return path == selectedDisks;
                }
            }
            for (var j = 0; j < disk.partitions.length; j++) {
                var partition = disk.partitions[j];
                // if path is partition, we need to check if
                // 1. the partition path is selected or
                // 2. its disk's path is selected
                if (path == partition.path) {
                    if ($.isArray(selectedDisks)) {
                        return ($.inArray(path, selectedDisks) != -1) ||
                            ($.inArray(disk.path, selectedDisks) != -1)
                    } else {
                        return path == selectedDisks || disk.path == selectedDisks;
                    }

                }
            }
        }
    }
    return false;
}

function propagate_journal_partition_list(list, disks, mode, selectedDataDisk) {
    var optgroups = [];
    // batch mode does not support specifying journal partitions
    if (mode != ADD_VOLUME_MODE.SINGLE_PARTITION_BATCH) {
        $.each(disks, function(index, disk) {
            var optgroup = {
                label: "",
                children: []
            };
            if (!disk.used &&
                !in_selected_disks(disk.path, selectedDataDisk) &&
                !contains_selected_disks(disk.path, selectedDataDisk)) {
                optgroup.children.push({
                        label: sprintf("%s %sM", disk.path, disk.size_mb),
                        value: disk.path
                });
            }
            if (!in_selected_disks(disk.path, selectedDataDisk)) {
                $.each(disk.partitions, function(index, partition) {
                    if (!partition.used) {
                        if (!in_selected_disks(partition.path, selectedDataDisk)) {
                            optgroup.children.push({
                                label: sprintf("%s %sM", partition_path(partition), partition.size_mb),
                                value: partition.path
                            });
                        }
                    }
                });
            }
            if (optgroup.children.length) {
                if (disk.type =='mpath')
                    optgroup.label = sprintf("%s ( %s %s )", disk.path, disk.slaves[0].vendor, disk.slaves[0].model);
                else
                    optgroup.label = sprintf("%s ( %s )", disk.path, disk.model);
                optgroups.push(optgroup);
            }
        });
    }
    if ($("#dialog-add-storage-volume").data("data_is_disk")) {
        optgroups.unshift({
            label: getText("SAME_AS_DATA_DISK"),
            value: "data"
        });
    }
    optgroups.unshift({
        label: getText("DEFAULT_JOURNAL_PARTITION"),
        value: ""
    });
    list.multiselect("dataprovider", optgroups);
}

function propagate_cache_partition_list(list, disks, selectedDataDisk, selectedJournalDisk, selectedCacheDisk) {
    var tempDisks = $.extend(true, {}, disks);
    unmark_used_disk(selectedCacheDisk, tempDisks);
    var optgroups = [];
    $.each(tempDisks, function(index, disk) {
        var optgroup = {
            label: "",
            children: []
        };
        if (!disk.used &&
            !in_selected_disks(disk.path, selectedDataDisk) &&
            !contains_selected_disks(disk.path, selectedDataDisk) &&
            !in_selected_disks(disk.path, selectedJournalDisk) &&
            !contains_selected_disks(disk.path, selectedJournalDisk)) {
            optgroup.children.push({
                label: sprintf("%s %sM", disk.path, disk.size_mb),
                value: disk.path
            });
        }
        if (!in_selected_disks(disk.path, selectedDataDisk) &&
            !in_selected_disks(disk.path, selectedJournalDisk)) {
            $.each(disk.partitions, function(index, partition) {
                if (!partition.used) {
                    if (!in_selected_disks(partition.path, selectedDataDisk) && !in_selected_disks(partition.path, selectedJournalDisk)) {
                        optgroup.children.push({
                            label: sprintf("%s %sM", partition_path(partition), partition.size_mb),
                            value: partition.path
                        });
                    }
                }
            });
        }
        if (optgroup.children.length) {
            if (disk.type =='mpath')
                optgroup.label = sprintf("%s ( %s %s )", disk.path, disk.slaves[0].vendor, disk.slaves[0].model);
            else
                optgroup.label = sprintf("%s ( %s )", disk.path, disk.model);
            optgroups.push(optgroup);
        }
    });
    // None option is allowed in add/edit storage volume dialog,
    // but not allowed in SAN volume/filesystem cache dialog
    if (selectedDataDisk !== undefined) {
        optgroups.unshift({
            label: getText("NONE"),
            value: ""
        });
    }
    list.multiselect("dataprovider", optgroups);
}

function propagate_spare_partition_list(list, disks, selectedDataDisk, selectedJournalDisk, selectedCacheDisk, selectedSpareDisk) {
    var tempDisks = $.extend(true, {}, disks);
    unmark_used_disk(selectedSpareDisk, tempDisks);
    var optgroups = [];
    $.each(tempDisks, function(index, disk) {
        var optgroup = {
            label: "",
            children: []
        };
        if (!disk.used &&
            !in_selected_disks(disk.path, selectedDataDisk) &&
            !contains_selected_disks(disk.path, selectedDataDisk) &&
            !in_selected_disks(disk.path, selectedJournalDisk) &&
            !contains_selected_disks(disk.path, selectedJournalDisk) &&
            !in_selected_disks(disk.path, selectedCacheDisk) &&
            !contains_selected_disks(disk.path, selectedCacheDisk)) {
            optgroup.children.push({
                label: sprintf("%s %sM", disk.path, disk.size_mb),
                value: disk.path
            });
        }
        if (!in_selected_disks(disk.path, selectedDataDisk) &&
            !in_selected_disks(disk.path, selectedJournalDisk) &&
            !in_selected_disks(disk.path, selectedCacheDisk)) {
            $.each(disk.partitions, function(index, partition) {
                if (!partition.used) {
                    if (!in_selected_disks(partition.path, selectedDataDisk) &&
                        !in_selected_disks(partition.path, selectedJournalDisk) &&
                        !in_selected_disks(partition.path, selectedCacheDisk)) {
                        optgroup.children.push({
                            label: sprintf("%s %sM", partition_path(partition), partition.size_mb),
                            value: partition.path
                        });
                    }
                }
            });
        }
        if (optgroup.children.length) {
            if (disk.type =='mpath')
                optgroup.label = sprintf("%s ( %s %s )", disk.path, disk.slaves[0].vendor, disk.slaves[0].model);
            else
                optgroup.label = sprintf("%s ( %s )", disk.path, disk.model);
            optgroups.push(optgroup);
        }
    });
    list.multiselect("dataprovider", optgroups);
}

function dialog_add_storage_volume_init() {
    $("#add-storage-volume-name").val("");
    $("#add-storage-volume-mode").val(ADD_VOLUME_MODE.SINGLE_PARTITION);
    $("#add-storage-volume-mode").prop('disabled', true);
    $("#add-storage-volume-compress input").prop("checked", false);
    $("#add-storage-volume-dedup input").prop("checked", false);
    $("#spare-disk-form-group").hide();
    $("#add-storage-volume-compress").hide();
    $("#add-storage-volume-dedup").hide();
    $("#add_sv_tab_osd_enable_osd").prop("checked", false);
    $("#add_sv_tab_osd_settings").hide();
    $("#add_sv_tab_osd_public_interface").empty();
    $("#add_sv_tab_osd_cluster_interface").empty();
    $("#dialog-add-storage-volume div[role='tabpanel'] ul[role='tablist'] a:first").tab("show");
    var dataDisk = $("#add-storage-volume-data-disk");
    var journalDisk = $("#add-storage-volume-journal-disk");
    var cacheDisk = $("#add-storage-volume-cache-disk");
    var spareDisk = $("#add-storage-volume-spare-disk");
    dataDisk.multiselect("dataprovider", []);
    dataDisk.multiselect("rebuild");
    journalDisk.multiselect("dataprovider", []);
    journalDisk.multiselect("rebuild");
    cacheDisk.multiselect("dataprovider", []);
    cacheDisk.multiselect("rebuild");
    spareDisk.multiselect("dataprovider", []);
    spareDisk.multiselect("rebuild");
    ajax_partition_list(hostIP, function(response) {
        $("#add-storage-volume-mode").prop('disabled', false);
        // fix bug 305: we don't support disks whose sector size is not 512 byte.
        g_partition_list = response.filter(function(disk) { return disk.sector_size == 512; });
        storage_volume_mode_change();
        if (!dataDisk.val()) {
            alert(getText("ERROR_NO_AVAILABLE_DATA_DEVS"));
            $("#dialog-add-storage-volume").modal("hide");
            return;
        }
    });
    ajax_host_nic_list(hostIP, function(response) {
        propagate_interface_list(response.interface_list, $("#add_sv_tab_osd_public_interface"), $("#add_sv_tab_osd_cluster_interface"));
    });
}

function dialog_add_storage_volume_ok() {
    var name = $("#add-storage-volume-name").val();
    var sv_type = 0;
    var sv_mode = $("#add-storage-volume-mode").val();
    var data_devs = [];
    var journal_dev = $("#add-storage-volume-journal-disk").val();
    var cache_dev = "";
    var spare_devs = [];
    var dedup = false;
    var compress = false;
    if (sv_mode == ADD_VOLUME_MODE.SINGLE_PARTITION) {
        var data_dev = $("#add-storage-volume-data-disk").val();
        if (data_dev) {
            data_devs = [data_dev];
        }
        cache_dev = $("#add-storage-volume-cache-disk").val();
    } else if (sv_mode == ADD_VOLUME_MODE.SINGLE_PARTITION_BATCH) {
        data_devs = $("#add-storage-volume-data-disk").val();
    } else if (sv_mode == ADD_VOLUME_MODE.STRIPED) {
        sv_type = 2;
        data_devs = $("#add-storage-volume-data-disk").val();
        cache_dev = $("#add-storage-volume-cache-disk").val();
        dedup = $("#add-storage-volume-dedup input").prop("checked");
        compress = $("#add-storage-volume-compress input").prop("checked");
    } else if (sv_mode == ADD_VOLUME_MODE.SOFTWARE_RAID) {
        sv_type = 3;
        data_devs = $("#add-storage-volume-data-disk").val();
        cache_dev = $("#add-storage-volume-cache-disk").val();
        spare_devs = $("#add-storage-volume-spare-disk").val();
        dedup = $("#add-storage-volume-dedup input").prop("checked");
        compress = $("#add-storage-volume-compress input").prop("checked");
    }
    var res = validate_storage_volume_name(name);
    if (!res[0]) {
        alert(res[1]);
        return;
    }
    if (!data_devs) {
        // data_devs is either null or []
        alert(getText("ERROR_NO_DATA_DISK_SELECTED"));
        return;
    }
    if (sv_mode == ADD_VOLUME_MODE.SOFTWARE_RAID) {
        if (data_devs.length < 3) {
            alert(getText("ERROR_RAID_DISKS_NOT_ENOUGH"));
            return;
        }
    }
    if (!spare_devs) {
        spare_devs = [];
    }

    function reload_and_hide_add_volume_dialog() {
        host_roles_refresh_page();
        $("#dialog-add-storage-volume").modal("hide");
    }

    ajax_storage_volume_add(
        hostIP, name, sv_type, data_devs, journal_dev, cache_dev, spare_devs, dedup, compress, function(response) {
        if ($("#add_sv_tab_osd_enable_osd").prop("checked")) {
            var cluster_iface = $("#add_sv_tab_osd_cluster_interface").val();
            var public_iface = $("#add_sv_tab_osd_public_interface").val();
            ajax_node_role_enable_osd(hostIP, response.sv_list, cluster_iface, public_iface, reload_and_hide_add_volume_dialog);
        }
        else {
            reload_and_hide_add_volume_dialog();
        }
    });
}

function storage_volume_mode_change() {
    var disks = g_partition_list;
    var dataDisk = $("#add-storage-volume-data-disk");
    var journalDisk = $("#add-storage-volume-journal-disk");
    $("#dialog-add-storage-volume").data("data_is_disk", is_data_disk(disks, dataDisk.val()));
    var cacheDisk = $("#add-storage-volume-cache-disk");
    var spareDisk = $("#add-storage-volume-spare-disk");
    var mode = $("#add-storage-volume-mode").val();
    if (mode == ADD_VOLUME_MODE.SINGLE_PARTITION) {
        dataDisk.removeAttr("multiple");
        dataDisk.multiselect("rebuild");
        propagate_data_partition_list(dataDisk, disks, mode);
        propagate_journal_partition_list(journalDisk, disks, mode, dataDisk.val());
        $("#cache-disk-form-group").show();
        propagate_cache_partition_list(cacheDisk, disks, dataDisk.val(), journalDisk.val());
        $("#spare-disk-form-group").hide();
        $("#add-storage-volume-dedup").hide();
        $("#add-storage-volume-compress").hide();
    } else if (mode == ADD_VOLUME_MODE.SINGLE_PARTITION_BATCH) {
        dataDisk.attr("multiple", "multiple");
        dataDisk.multiselect("rebuild");
        propagate_data_partition_list(dataDisk, disks, mode);
        propagate_journal_partition_list(journalDisk, disks, mode, dataDisk.val());
        $("#cache-disk-form-group").hide();
        $("#spare-disk-form-group").hide();
        $("#add-storage-volume-dedup").hide();
        $("#add-storage-volume-compress").hide();
    } else if (mode == ADD_VOLUME_MODE.STRIPED) {
        dataDisk.attr("multiple", "multiple");
        dataDisk.multiselect("rebuild");
        propagate_data_partition_list(dataDisk, disks, mode);
        propagate_journal_partition_list(journalDisk, disks, mode, dataDisk.val());
        $("#cache-disk-form-group").show();
        propagate_cache_partition_list(cacheDisk, disks, dataDisk.val(), journalDisk.val());
        $("#spare-disk-form-group").hide();
        $("#add-storage-volume-dedup").show();
        $("#add-storage-volume-compress").show();
    } else if (mode == ADD_VOLUME_MODE.SOFTWARE_RAID) {
        dataDisk.attr("multiple", "multiple");
        dataDisk.multiselect("rebuild");
        propagate_data_partition_list(dataDisk, disks, mode);
        propagate_journal_partition_list(journalDisk, disks, mode, dataDisk.val());
        $("#cache-disk-form-group").show();
        propagate_cache_partition_list(cacheDisk, disks, dataDisk.val(), journalDisk.val());
        $("#spare-disk-form-group").show();
        propagate_spare_partition_list(spareDisk, disks, dataDisk.val(), journalDisk.val(), cacheDisk.val());
        $("#add-storage-volume-dedup").show();
        $("#add-storage-volume-compress").show();
    }
}

// check if selected data partitions are all disks
function is_data_disk(disks, selectedDataDisk) {
    var dataIsDisk = true;
    if (selectedDataDisk) {
        if ($.isArray(selectedDataDisk)) {
            $.each(selectedDataDisk, function(index1, dataDisk) {
                var foundDisk = false;
                $.each(disks, function(index2, disk) {
                    if (dataDisk == disk.path) {
                        foundDisk = true;
                        return false;
                    }
                });
                if (!foundDisk) {
                    dataIsDisk = false;
                    return false;
                }
            });
        } else {
            var foundDisk = false;
            $.each(disks, function(index, disk) {
                if (selectedDataDisk == disk.path) {
                    foundDisk = true;
                    return false;
                }
            });
            if (!foundDisk) {
                dataIsDisk = false;
            }
        }
    }
    return dataIsDisk;
}

function auto_deselect_other_disks(list, element) {
    var firstDisk = element.parent().find('option').first().val();
    var currentDisk = element.val();
    if (currentDisk == firstDisk) {
        var allDisks = $.makeArray(element.parent().children());
        allDisks.shift();  // remove first(current) disk
        $.each(allDisks, function(index, elem){
            if (contains_selected_disks(currentDisk, $(elem).val())) {
                list.multiselect('deselect', $(elem).val());
            }
        });
    } else {
        if (contains_selected_disks(firstDisk, currentDisk)) {
            list.multiselect('deselect', firstDisk);
        }
    }
}

function data_disk_change(element, checked) {
    var disks = g_partition_list;
    var dataDisk = $("#add-storage-volume-data-disk");
    var journalDisk = $("#add-storage-volume-journal-disk");
    $("#dialog-add-storage-volume").data("data_is_disk", is_data_disk(disks, dataDisk.val()));
    var cacheDisk = $("#add-storage-volume-cache-disk");
    var spareDisk = $("#add-storage-volume-spare-disk");
    var mode = $("#add-storage-volume-mode").val();
    if (mode == ADD_VOLUME_MODE.SINGLE_PARTITION ||
        mode == ADD_VOLUME_MODE.STRIPED) {
        propagate_journal_partition_list(journalDisk, disks, mode, dataDisk.val());
        propagate_cache_partition_list(cacheDisk, disks, dataDisk.val(), journalDisk.val());
    } else if (mode == ADD_VOLUME_MODE.SINGLE_PARTITION_BATCH) {
        propagate_journal_partition_list(journalDisk, disks, mode, dataDisk.val());
    } else if (mode == ADD_VOLUME_MODE.SOFTWARE_RAID) {
        propagate_journal_partition_list(journalDisk, disks, mode, dataDisk.val());
        propagate_cache_partition_list(cacheDisk, disks, dataDisk.val(), journalDisk.val());
        propagate_spare_partition_list(spareDisk, disks, dataDisk.val(), journalDisk.val(), cacheDisk.val());
    }
    if (dataDisk.attr("multiple") && checked) {
        auto_deselect_other_disks(dataDisk, element);
    }
}

function journal_disk_change(element, checked) {
    var disks = g_partition_list;
    var dataDisk = $("#add-storage-volume-data-disk");
    var journalDisk = $("#add-storage-volume-journal-disk");
    var cacheDisk = $("#add-storage-volume-cache-disk");
    var spareDisk = $("#add-storage-volume-spare-disk");
    var mode = $("#add-storage-volume-mode").val();
    if (mode == ADD_VOLUME_MODE.SINGLE_PARTITION ||
        mode == ADD_VOLUME_MODE.STRIPED) {
        propagate_cache_partition_list(cacheDisk, disks, dataDisk.val(), journalDisk.val());
    } else if (mode == ADD_VOLUME_MODE.SOFTWARE_RAID) {
        propagate_cache_partition_list(cacheDisk, disks, dataDisk.val(), journalDisk.val());
        propagate_spare_partition_list(spareDisk, disks, dataDisk.val(), journalDisk.val(), cacheDisk.val());
    }
}

function cache_disk_change(element, checked) {
    var disks = g_partition_list;
    var dataDisk = $("#add-storage-volume-data-disk");
    var journalDisk = $("#add-storage-volume-journal-disk");
    var cacheDisk = $("#add-storage-volume-cache-disk");
    var spareDisk = $("#add-storage-volume-spare-disk");
    var mode = $("#add-storage-volume-mode").val();
    if (mode == ADD_VOLUME_MODE.SOFTWARE_RAID) {
        propagate_spare_partition_list(spareDisk, disks, dataDisk.val(), journalDisk.val(), cacheDisk.val());
    }
}

function spare_disk_change(element, checked) {
    var spareDisk = $("#add-storage-volume-spare-disk");
    if (checked) {
        auto_deselect_other_disks(spareDisk, element);
    }
}

function edit_cache_disk_change(element, checked) {
    var disks = g_partition_list;
    var dataDisk = $("#edit-storage-volume-data-disk");
    var journalDisk = $("#edit-storage-volume-journal-disk");
    var cacheDisk = $("#edit-storage-volume-cache-disk");
    var spareDisk = $("#edit-storage-volume-spare-disk");
    var type = $("#edit-storage-volume-type").val();
    if (type == getText(STORAGE_VOLUME_TYPE[3])) {
        propagate_spare_partition_list(spareDisk, disks, dataDisk.val().split(","), journalDisk.val(), cacheDisk.val());
    }
}

function edit_spare_disk_change(element, checked) {
    var spareDisk = $("#edit-storage-volume-spare-disk");
    if (checked) {
        auto_deselect_other_disks(spareDisk, element);
    }
}

function delete_storage_volume() {
    if (confirm(getText("CONFIRM_DELETE_STORAGE_VOLUME"))) {
        var names = [];
        iterateSelectedItems("#storage-volume-table", function(last, volume) {
            names.push(volume.name);
        });
        ajax_storage_volume_remove(hostIP, names, function(response) {
            host_roles_refresh_page();
        });
    }
}

function dialog_edit_storage_volume_init() {
    var storageVolumeType = $("#edit-storage-volume-type");
    var storageVolumeName = $("#edit-storage-volume-name");
    var dataDisk = $("#edit-storage-volume-data-disk");
    var journalDisk = $("#edit-storage-volume-journal-disk");
    var cacheDisk = $("#edit-storage-volume-cache-disk");
    var spareDisk = $("#edit-storage-volume-spare-disk");
    iterateSelectedItems("#storage-volume-table", function(last, volume) {
        if (volume.sv_type == 3) {
            $("#edit-spare-disk-form-group").show();
        } else {
            $("#edit-spare-disk-form-group").hide();
        }
        storageVolumeType.val(getText(STORAGE_VOLUME_TYPE[volume.sv_type]));
        storageVolumeName.val(volume.name);
        dataDisk.val(volume.data_devs);
        if (volume.journal_dev) {
            journalDisk.val(volume.journal_dev);
        } else {
            journalDisk.val(getText("DEFAULT_JOURNAL_PARTITION"));
        }
        cacheDisk.multiselect("dataprovider", []);
        cacheDisk.multiselect("rebuild");
        spareDisk.multiselect("dataprovider", []);
        spareDisk.multiselect("rebuild");
        ajax_partition_list(hostIP, function(response) {
            g_partition_list = response;
            // it's possible cache disk and spare disk are in use
            // so they won't appear in each other's partition list.
            // it should be ok because we're not sure if it works to
            // directly assign a in-used spare dev to cache dev in zpool
            propagate_cache_partition_list(cacheDisk, response, volume.data_devs, volume.journal_dev, volume.cache_dev);
            cacheDisk.multiselect('deselectAll', false);
            cacheDisk.multiselect('select', volume.cache_dev);
            propagate_spare_partition_list(spareDisk, response, volume.data_devs, volume.journal_dev, volume.cache_dev, volume.spare_devs);
            spareDisk.multiselect('deselectAll', false);
            spareDisk.multiselect('select', volume.spare_devs);
        });
    });
}

function dialog_edit_storage_volume_ok() {
    var name = $("#edit-storage-volume-name").val();
    var cache_dev = $("#edit-storage-volume-cache-disk").val();
    var spare_devs = $("#edit-storage-volume-spare-disk").val();
    if (!spare_devs) {
        spare_devs = [];
    }
    ajax_storage_volume_edit(hostIP, name, cache_dev, spare_devs, function(response) {
        host_roles_refresh_page();
        $("#dialog-edit-storage-volume").modal("hide");
    });
}

function storage_volume_list_item_html(sv) {
    return sprintf('<li class="list-group-item">%s</li>', sv.name);
}

function dialog_repair_storage_volume_init() {
    $("#option-scan").prop("checked", true);
    $("#storage-volumes-to-repair").empty();
}

function dialog_repair_storage_volume_inited() {
    var hasOnlineStorageVolume = false;
    iterateSelectedItems("#storage-volume-table", function(last, sv) {
        if (sv.state == STORAGE_VOLUME_STATE.ONLINE || sv.state == STORAGE_VOLUME_STATE.ONLINE_FAILED) {
            $("#storage-volumes-to-repair").append(storage_volume_list_item_html(sv));
            hasOnlineStorageVolume = true;
        }
    });
    if (!hasOnlineStorageVolume) {
        alert(getText("ERROR_NO_ONLINE_STORAGE_VOLUME"));
        $("#dialog-repair-storage-volume").modal("hide");
        return;
    }
}

function dialog_repair_storage_volume_ok() {
    var names = [];
    iterateSelectedItems("#storage-volume-table", function(last, sv) {
        names.push(sv.name);
    });
    if ($("#option-scan").prop("checked")) {
        ajax_storage_volume_scan(hostIP, names, function(response) {
            host_roles_refresh_page();
            $("#dialog-repair-storage-volume").modal("hide");
        });
    } else if ($("#option-reformat").prop("checked")) {
        ajax_storage_volume_reformat(hostIP, names, function(response) {
            host_roles_refresh_page();
            $("#dialog-repair-storage-volume").modal("hide");
        });
    }
}

function interface_option_html(eth, eth_info) {
    return sprintf('<option value="%s">%s - %s</option>', eth, eth, eth_info.ipv4);
}

function none_option_html() {
    return sprintf('<option value="">%s</option>', getText("NONE"));
}

function can_enable_osd(state) {
    if (state == STORAGE_VOLUME_STATE.OFFLINE) {
        return true;
    }
    return false;
}

function can_disable_osd(state) {
    if (state == STORAGE_VOLUME_STATE.ONLINE ||
        state == STORAGE_VOLUME_STATE.ONLINE_FAILED ||
        state == STORAGE_VOLUME_STATE.DISABLE_FAILED ||
        state == STORAGE_VOLUME_STATE.ENABLE_FAILED) {
        return true;
    }
    return false;
}

function dialog_enable_osd_init() {
    $("#storage-volumes-to-enable").empty();
    var publicInterfaces = $("#osd-public-interface");
    publicInterfaces.prop("disabled", false);
    publicInterfaces.empty();
    var clusterInterfaces = $("#osd-cluster-interface");
    clusterInterfaces.prop("disabled", false);
    clusterInterfaces.empty();
    ajax_host_nic_list(hostIP, function(response) {
        var hasOfflineStorageVolume = false;
        iterateSelectedItems("#storage-volume-table", function(last, sv) {
            if (can_enable_osd(sv.state)) {
                hasOfflineStorageVolume = true;
                $("#storage-volumes-to-enable").append(storage_volume_list_item_html(sv));
            }
        });
        if (!hasOfflineStorageVolume) {
            alert(getText("ERROR_NO_OFFLINE_STORAGE_VOLUME"));
            $("#dialog-enable-osd").modal("hide");
            return;
        }
        propagate_interface_list(response.interface_list, publicInterfaces, clusterInterfaces);
    });
}

function dialog_enable_osd_ok() {
    var cluster_iface = $("#osd-cluster-interface").val();
    var public_iface = $("#osd-public-interface").val();
    var sv_list = [];
    iterateSelectedItems("#storage-volume-table", function(last, sv) {
        if (can_enable_osd(sv.state)) {
            sv_list.push(sv.name);
        }
    });
    ajax_node_role_enable_osd(hostIP, sv_list, cluster_iface, public_iface, function(response) {
        host_roles_refresh_page();
        $("#dialog-enable-osd").modal("hide");
    });
}

function dialog_disable_osd_init() {
    $("#storage-volumes-to-disable").empty();
}

function dialog_disable_osd_inited() {
    var hasOnlineStorageVolume = false;
    iterateSelectedItems("#storage-volume-table", function(last, sv) {
        if (can_disable_osd(sv.state)) {
            hasOnlineStorageVolume = true;
            $("#storage-volumes-to-disable").append(storage_volume_list_item_html(sv));
        }
    });
    if (!hasOnlineStorageVolume) {
        alert(getText("ERROR_NO_ONLINE_STORAGE_VOLUME"));
        $("#dialog-disable-osd").modal("hide");
        return;
    }
}

function dialog_disable_osd_ok() {
    var sv_list = [];
    iterateSelectedItems("#storage-volume-table", function(last, sv) {
        if (can_disable_osd(sv.state)) {
            sv_list.push(sv.name);
        }
    });
    ajax_node_role_disable_osd(hostIP, sv_list, $("#disable_osd_force").prop("checked"), function(response) {
        host_roles_refresh_page();
        $("#dialog-disable-osd").modal("hide");
    });
}

function propagate_interface_list(interfaces, publicList, clusterList) {
    var public_eth = null;
    var storage_eth = null;
    var cluster_eth = null;
    var public_eth_candidate = null;
    if (clusterList) {
        clusterList.append(none_option_html());
    }
    $.each(interfaces, function(eth, eth_info) {
	var has_role = false;
	if (!eth_info.ipv4)
	    return;
        publicList.append(interface_option_html(eth, eth_info));
        if (clusterList) {
            clusterList.append(interface_option_html(eth, eth_info));
        }
        if ($.inArray(INTERFACE_ROLE.PUBLIC, eth_info.role) >= 0) {
            public_eth = eth;
            has_role = true;
        }
        if ($.inArray(INTERFACE_ROLE.CLUSTER, eth_info.role) >= 0) {
            cluster_eth = eth;
            has_role = true;
        }
        if ($.inArray(INTERFACE_ROLE.STORAGE, eth_info.role) >= 0) {
            storage_eth = eth;
            has_role = true;
        }
        if (!public_eth_candidate && !has_role)
            public_eth_candidate = eth;
    });
    if (public_eth === null) {
        if (public_eth_candidate) {
            publicList.val(public_eth_candidate);
        } else {
            if (storage_eth)
                publicList.val(storage_eth);
        }
    } else {
        // fix public interface
        publicList.val(public_eth);
        publicList.prop("disabled", true);
    }
    if (cluster_eth && clusterList) {
        // fix cluster interface
        clusterList.val(cluster_eth);
        clusterList.prop("disabled", true);
    }
}

function propagate_san_volume_list(list, targets) {
    var optgroups = [];
    var poolIDMap = {};
    $.each(targets, function(index, target) {
        var optgroup = {
            label: target.name,
            children: []
        };
        $.each(target.volumes, function(index, volume) {
            if (volume.has_cache === false) {
                optgroup.children.push({
                    label: sprintf("%s (%s)", volume.name, volume.size_mb),
                    value: volume.rbd_img
                });
                poolIDMap[volume.rbd_img] = volume.pool_id;
            }
        });
        if (optgroup.children.length > 0){
            optgroups.push(optgroup);
        }
    });
    list.data('pool_id_map', poolIDMap);
    list.multiselect("dataprovider", optgroups);
}

function dialog_add_san_volume_cache_init() {
    var sanVolumes = $("#add-san-volume-lun");
    var cacheDisks = $("#add-cache-disk");
    sanVolumes.multiselect("dataprovider", []);
    sanVolumes.removeAttr("multiple");
    sanVolumes.multiselect("rebuild");
    cacheDisks.multiselect("dataprovider", []);
    cacheDisks.removeAttr("multiple");
    cacheDisks.multiselect("rebuild");
    $.when(ajax_rbd_volume_list(hostIP, null, true), ajax_partition_list(hostIP, null, true)).done(function(a, b) {
        propagate_san_volume_list(sanVolumes, a[0].response.targets);
        propagate_cache_partition_list(cacheDisks, b[0].response);
        if (sanVolumes.children().length <= 0) {
            alert(getText("ERROR_NO_SAN_VOLUME"));
            $("#dialog-add-san-volume-cache").modal("hide");
            return;
        }
        if (cacheDisks.children().length <= 0) {
            alert(getText("ERROR_NO_AVAILABLE_CACHE_DISK"));
            $("#dialog-add-san-volume-cache").modal("hide");
            return;
        }
    });
}

function dialog_add_san_volume_cache_ok() {
    var sanVolume = $("#add-san-volume-lun").val();
    var cacheDisk = $("#add-cache-disk").val();
    var poolIDMap = $("#add-san-volume-lun").data("pool_id_map");

    ajax_rbd_volume_cache_create(
        hostIP, sanVolume, poolIDMap[sanVolume], cacheDisk, function(response) {
        host_roles_refresh_page();
        $("#dialog-add-san-volume-cache").modal("hide");
    });
}

function delete_san_volume_cache() {
    if (confirm(getText("CONFIRM_DELETE_SAN_VOLUME_CACHE"))) {
        var cache_names = [];
        iterateSelectedItems("#san-volume-cache-table", function(last, cache) {
            cache_names.push(cache.cache_name);
        });
        ajax_rbd_volume_cache_delete(hostIP, cache_names, function(response) {
            host_roles_refresh_page();
        });
    }
}

function dialog_enable_fs_cache_init() {
    $("#fs-cache-size-input").prop("disabled", true);
    $("#use-whole-disk-checkbox").prop("disabled", true);
    var fsCacheDisks = $("#add-fs-cache-disk");
    fsCacheDisks.multiselect("dataprovider", []);
    fsCacheDisks.removeAttr("multiple");
    fsCacheDisks.multiselect("rebuild");
    ajax_partition_list(hostIP, function(response) {
        $("#dialog-enable-fs-cache").data("partition_list", response);
        propagate_cache_partition_list(fsCacheDisks, response);
        if (fsCacheDisks.children().length <= 0) {
            alert(getText("ERROR_NO_AVAILABLE_CACHE_DISK"));
            $("#dialog-enable-fs-cache").modal("hide");
            return;
        }
        fs_cache_change();
    }, true);
}

function fs_cache_change() {
    var selectedCache = $("#add-fs-cache-disk").val();
    var disks = $("#dialog-enable-fs-cache").data("partition_list");
    var isPartition = true;
    $.each(disks, function(index, disk) {
        if (selectedCache == disk.path) {
            isPartition = false;
        }
    });
    if (isPartition) {
        $("#use-whole-disk-checkbox").prop("checked", false);
        $("#fs-cache-size-input").val("");
        $("#fs-cache-size-input").prop("disabled", true);
        $("#use-whole-disk-checkbox").prop("disabled", true);
    } else {
        $("#fs-cache-size-input").prop("disabled", false);
        $("#use-whole-disk-checkbox").prop("disabled", false);
    }
}

function use_whole_disk_checked(){
    if ($("#use-whole-disk-checkbox").prop("checked")) {
        $("#fs-cache-size-input").val("");
        $("#fs-cache-size-input").prop("disabled", true);
    } else {
        $("#fs-cache-size-input").prop("disabled", false);
    }
}

function dialog_enable_fs_cache_ok() {
    var selectedCache = $("#add-fs-cache-disk").val();
    var disks = $("#dialog-enable-fs-cache").data("partition_list");
    var isPartition = true;
    var useWholeDisk = $("#use-whole-disk-checkbox").prop("checked");
    var cacheSize = parseInt($("#fs-cache-size-input").val());
    var isValidInput = false;
    var diskSize = 0;

    $.each(disks, function(index, disk) {
        if (selectedCache == disk.path) {
            isPartition = false;
            diskSize = disk.size_mb;
        }
    });

    if (isPartition) {
        isValidInput = true;
    } else {
        if (useWholeDisk) {
            isValidInput = true;
        } else {
            if (cacheSize > 0 && (cacheSize*1024 + 1) < diskSize) {
                isValidInput = true;
            }
        }
    }

    if (isValidInput) {
        ajax_fs_cache_enable(hostIP, selectedCache, isPartition, useWholeDisk, cacheSize, function(response) {
            host_roles_refresh_page();
            $("#dialog-enable-fs-cache").modal("hide");
        });
    } else{
        alert(getText("ERROR_INVALID_CACHE_SIZE"));
    }
}

function disable_fs_cache(){
    if (confirm(getText("CONFIRM_DISABLE_FS_CACHE"))) {
        ajax_fs_cache_disable(hostIP, function(response) {
            host_roles_refresh_page();
        });
    }
}

function dialog_enable_gw_init() {
    var publicInterfaces = $("#gw-public-interface");
    publicInterfaces.empty();
    publicInterfaces.prop("disabled", false);
    ajax_host_nic_list(hostIP, function(response) {
        propagate_interface_list(response.interface_list, publicInterfaces);
    });
}

function dialog_enable_gw_ok() {
    var public_iface = $("#gw-public-interface").val();
    ajax_gateway_role_enable(hostIP, public_iface, function(response) {
        host_roles_refresh_page();
        $("#dialog-enable-gw").modal("hide");
    });
}

function disable_gw_ok() {
    if (confirm(getText("CONFIRM_DISABLE_GW"))) {
        ajax_gateway_role_disable(hostIP, function(response) {
            host_roles_refresh_page();
        });
    }
}

function dialog_enable_rrs_init() {
    var publicInterfaces = $("#rrs-public-interface");
    publicInterfaces.empty();
    publicInterfaces.prop("disabled", false);
    ajax_host_nic_list(hostIP, function(response) {
        propagate_interface_list(response.interface_list, publicInterfaces);
    });
}

function dialog_enable_rrs_ok() {
    var public_iface = $("#rrs-public-interface").val();
    ajax_node_role_enable_rrs(hostIP, public_iface, function(response) {
        host_roles_refresh_page();
        $("#dialog-enable-rrs").modal("hide");
    });
}

function disable_rrs_ok() {
    if (confirm(getText("CONFIRM_DISABLE_RRS"))) {
        ajax_node_role_disable_rrs(hostIP, function(response) {
            host_roles_refresh_page();
        });
    }
}

function dialog_change_default_journal_init() {
    var defaultJournalPartition = $("#default-journal-partition");
    defaultJournalPartition.multiselect("dataprovider", []);
    defaultJournalPartition.multiselect("rebuild");
    var currentJournal = $("#default-journal-text").text();
    ajax_partition_list(hostIP, function(response) {
        propagate_default_journal_partition_list(defaultJournalPartition, response, currentJournal);
        defaultJournalPartition.multiselect('deselectAll', false);
        // the default journal partition in /dev/sda probably not be
        // in the list, but here we assume user want to change default
        // to partitions other than /dev/sda so it can be ignored.
        defaultJournalPartition.multiselect('select', currentJournal);
        if (defaultJournalPartition.children().length <= 0) {
            alert(getText("ERROR_NO_AVAILABLE_JOURNAL_DEVS"));
            $("#dialog-change-default-journal").modal("hide");
            return;
        }
    });
}

function dialog_change_default_journal_ok() {
    var journalDev = $("#default-journal-partition").val();
    if (!journalDev) {
        alert(getText("ERROR_NO_DEFAULT_JOURNAL_SELECTED"));
        return;
    }
    ajax_journal_partition_edit(hostIP, journalDev, function(response) {
        host_roles_refresh_page();
        $("#dialog-change-default-journal").modal("hide");
    });
}

function refresh_gateway_progress(enable) {
    ajax_gateway_role_progress(hostIP, enable, function(response) {
        switch (response.status) {
            case 'running':
                $("#gw-progress").show();
                var percentage = response.info.progress + "%";
                $("#gw-progress .progress-bar").css("width", percentage);
                $("#gw-progress .progress-bar").text(percentage);
                gwProgressTimer = setTimeout(function(){
                    refresh_gateway_progress(enable);}, 1);
                break;
            case 'done':
            case 'failed':
                $('#gw-progress').hide();
                if (gwProgressTimer) {
                    clearTimeout(gwProgressTimer);
                    gwProgressTimer = null;
                    host_roles_refresh_page();
                }
                break;
            default:
                break;
        }
        if (response.info && response.info.need_reboot) {
            $("#gw-reboot").show();
        }
    }, false);
}

function refresh_gateway_panel(gwState, sanVolumeCacheInfo, fsCacheInfo, recurrence) {
    $("#gw-status-text").text(getText(ROLE_STATE[gwState]));
    $("#gw-status-text").children().remove();

    // enabling & disabling - check task running progress
    // disabled - check if need reboot
    if (ROLE_STATE[gwState] == "ENABLING" ||
        ROLE_STATE[gwState] == "DISABLING" ||
        ROLE_STATE[gwState] == "DISABLED") {
        var enable = (ROLE_STATE[gwState] == "ENABLING");
        if (!gwProgressTimer)
            refresh_gateway_progress(enable);
    }

    $("#enable-gw").prop("disabled", true);
    $("#disable-gw").prop("disabled", true);
    $("#san-volume-cache-panel").hide();
    $("#fs-cache-panel").hide();
    if (g_dashboard.osd_enabled()) {
        if (gwState == "0" || gwState == "4") {
            $("#enable-gw").prop("disabled", false);
        } else if (gwState == "2" || gwState == "5") {
            var sanVolumeCacheTable = $("#san-volume-cache-table").dataTable();
            if (!recurrence) {
                clearSelectedItems('#san-volume-cache-table');
            }
            if (selectedItemsLength("#san-volume-cache-table") === 0) {
                sanVolumeCacheTable.fnClearTable();
                if (sanVolumeCacheInfo.length) {
                    sanVolumeCacheTable.fnAddData(sanVolumeCacheInfo);
                }
            }
            if (fsCacheInfo.is_enabled) {
                $("#enable-fs-cache").prop("disabled", true);
                $("#disable-fs-cache").prop("disabled", false);
                $("#fs-cache-status-text").text(sprintf("%s (%s - %d MB)", getText(ROLE_STATE[2]), fsCacheInfo.cache_partition, fsCacheInfo.cache_size));
            } else {
                $("#enable-fs-cache").prop("disabled", false);
                $("#disable-fs-cache").prop("disabled", true);
                $("#fs-cache-status-text").text(getText(ROLE_STATE[0]));
            }
            $("#disable-gw").prop("disabled", false);
            $("#san-volume-cache-panel").show();
            $("#fs-cache-panel").show();
        }
    }
}


function refresh_rrs_progress(enable) {
    ajax_node_role_rrs_progress(hostIP, enable, function(response) {
        var percentage = response.progress + "%";
        $("#rrs-progress .progress-bar").css("width", percentage);
        $("#rrs-progress .progress-bar").text(percentage);
        if (rrsProgressTimer) {
            rrsProgressTimer = setTimeout(function(){
                refresh_rrs_progress(enable);}, 1);
        }
    }, false);
}

function refresh_rrs_panel(rrsState) {
    $("#rrs-status-text").text(getText(ROLE_STATE[rrsState]));
    $("#rrs-status-text").children().remove();
    if (ROLE_STATE[rrsState] == "ENABLING" ||
        ROLE_STATE[rrsState] == "DISABLING") {
        var enable = (ROLE_STATE[rrsState] == "ENABLING");
        $("#rrs-progress").show();
        if (!rrsProgressTimer) {
            $("#rrs-progress .progress-bar").css("width", "0%");
            $("#rrs-progress .progress-bar").text("0%");
            rrsProgressTimer = setTimeout(function(){
                refresh_rrs_progress(enable);}, 1);
        }
    } else {
        $("#rrs-progress").hide();
        if (rrsProgressTimer) {
            clearTimeout(rrsProgressTimer);
            rrsProgressTimer = null;
        }
    }

    $("#enable-rrs").prop("disabled", true);
    $("#disable-rrs").prop("disabled", true);
    if (g_dashboard.osd_enabled()) {
        $("#enable-rrs").prop("disabled", true);
        $("#disable-rrs").prop("disabled", true);
        if (rrsState == "0" || rrsState == "4") {
            $("#enable-rrs").prop("disabled", false);
        } else if (rrsState == "2" || rrsState == "5") {
            $("#disable-rrs").prop("disabled", false);
        }
    }
}

function refresh_osd_progress(enable) {
    ajax_node_role_osd_progress(hostIP, enable, function(response) {
        var percentage = response.progress + "%";
        $("#osd-progress .progress-bar").css("width", percentage);
        $("#osd-progress .progress-bar").text(percentage);
        $("#osd-progress").data("svs", response.svs);
        if (osdProgressTimer) {
            osdProgressTimer = setTimeout(function(){
                refresh_osd_progress(enable);}, 1);
        }
    }, false);
}

function refresh_osd_panel(storageVolumes, osdState, recurrence) {
    if (ROLE_STATE[osdState] == "ENABLING" ||
        ROLE_STATE[osdState] == "DISABLING") {
        var enable = (ROLE_STATE[osdState] == "ENABLING");
        $("#osd-progress").data("state", ROLE_STATE[osdState]);
        $("#osd-progress").show();
        if (!osdProgressTimer) {
            $("#osd-progress .progress-bar").css("width", "0%");
            $("#osd-progress .progress-bar").text("0%");
            osdProgressTimer = setTimeout(function(){
                refresh_osd_progress(enable);}, 1);
        }
    } else {
        $("#osd-progress").hide();
        $("#osd-progress").removeData("state");
        if (osdProgressTimer) {
            clearTimeout(osdProgressTimer);
            osdProgressTimer = null;
        }
    }
    var storageVolumeTable = $("#storage-volume-table").dataTable();
    if (!recurrence) {
        clearSelectedItems("#storage-volume-table");
    }
    if (selectedItemsLength("#storage-volume-table") === 0) {
        storageVolumeTable.fnClearTable();
        if (storageVolumes.length) {
            storageVolumeTable.fnAddData(storageVolumes);
        }
    }
}

function host_roles_refresh_page(recurrence, initCompleted) {
    $.when(ajax_storage_volume_list(hostIP, null, !recurrence),
        ajax_node_roles([hostIP], null, !recurrence),
        ajax_journal_partition_get(hostIP, null, !recurrence),
        ajax_cached_volume_list(hostIP, null, !recurrence),
        ajax_fs_cache_status(hostIP, null, !recurrence)).done(function(a, b, c, d, e) {

        refresh_osd_panel(a[0].response, b[0].response[0].osd, recurrence);
        refresh_gateway_panel(b[0].response[0].gw, d[0].response, e[0].response, recurrence);
        refresh_rrs_panel(b[0].response[0].rrs);

        $("#default-journal-text").text(c[0].response);

        if (initCompleted) {
            $("#content").show();
            initCompleted();
        }
        if (recurrence || initCompleted) {
            refreshTimer = setTimeout(function() {
                host_roles_refresh_page(true);
            }, 10000);
        }
    });
}

function storage_volume_detail_html(sv) {
    var list = $('<div class="list-group">');
    list.append(sprintf('<div class="list-group-item"><label data-translate="CACHE_DISK" class="control-label">Cache Disk</label><span class="pull-right">%s</span></div>', sv.cache_dev));
    if (sv.sv_type == 3) {
        list.append(sprintf('<div class="list-group-item"><label data-translate="SPARE_DISK" class="control-label">Spare Disk(s)</label><span class="pull-right">%s</span></div>',sv.spare_devs));
    }
    if (sv.sv_type == 2 || sv.sv_type == 3) {
        list.append(sprintf('<div class="list-group-item"><label data-translate="ENABLE_COMPRESS" class="control-label">Enable Compression</label><span class="pull-right">%s</span></div>', sv.compress));
        list.append(sprintf('<div class="list-group-item"><label data-translate="ENABLE_DEDUP" class="control-label">Enable Deduplication</label><span class="pull-right">%s</span></div>', sv.dedup));
    }
    return list;
}

function init_storage_volume_table() {
    $("#storage-volume-table").dataTable({
        "aoColumns": [
            {
                "bSortable": false,
                "sClass": "storage-volume-check center",
                "mData": null,
                "mRender": function(data, type, full) {
                    return '<input type="checkbox"></input>';
                }
            },
            {
                "sTitle": getText("NAME"),
                "sClass": "storage-volume-name",
                "mData": "name"
            },
            {
                "sTitle": getText("STATE"),
                "sClass": "storage-volume-state",
                "mData": "state",
                "mRender": function(state, type, full) {
                    // make storage volume state consistent with OSD state
                    var svs = $("#osd-progress").data("svs");
                    var osdState = $("#osd-progress").data("state");
                    if (svs && $.inArray(full.name, svs) != -1) {
                        if (osdState == "ENABLING") {
                            return getText(STORAGE_VOLUME_STATE.ENABLING);
                        } else if (osdState == "DISABLING") {
                            return getText(STORAGE_VOLUME_STATE.DISABLING);
                        }
                    }
                    if (state == STORAGE_VOLUME_STATE.SCANNING ||
                        state == STORAGE_VOLUME_STATE.REFORMATING) {
                        return getText(state) + '<img src="images/running.gif">';
                    } else {
                        return getText(state);
                    }
                }
            },
            {
                "sTitle": getText("TYPE"),
                "sClass": "storage-volume-type",
                "mData": "sv_type",
                "mRender": function(sv_type, type, full) {
                    if (sv_type in STORAGE_VOLUME_TYPE) {
                        var svText = getText(STORAGE_VOLUME_TYPE[sv_type]);
                        var additions = [];
                        if (full.dedup) {
                            additions.push(getText("DEDUP"));
                        }
                        if (full.compress) {
                            additions.push(getText("COMPRESS"));
                        }
                        if (sv_type == 3) {
                            if (full.spare_devs.length > 0) {
                                additions.push(getText("SPARED"));
                            }
                        }
                        if (additions.length > 0) {
                            return svText + " (" + additions.join("+") + ")";
                        } else {
                            return svText;
                        }
                    } else {
                        return getText("UNKNOWN");
                    }
                }
            },
            {
                "sTitle": getText("DATA"),
                "sClass": "storage-volume-data-dev",
                "mData": "data_devs"
            },
            {
                "sTitle": getText("JOURNAL"),
                "sClass": "storage-volume-journal-dev",
                "mData": "journal_dev",
                "mRender": function(journal_dev, type, full) {
                    if (journal_dev) {
                        return journal_dev;
                    } else {
                        return getText("DEFAULT");
                    }
                }
            },
            {
                "sTitle": getText("CACHE"),
                "sClass": "storage-volume-cache",
                "mData": "cache_dev",
                "mRender": function(cache_dev, type, full) {
                    if (cache_dev) {
                        return cache_dev;
                    } else {
                        return getText("NONE");
                    }
                }
            },
            {
                "sTitle": getText("OSD_ID"),
                "sClass": "storage-volume-osd-id",
                "mData": "osd_id"
            }
        ],
        "fnDrawCallback": function(oSettings) {
            update_storage_volume_button_status();
            $(".storage-volume-check").click(update_storage_volume_button_status);
        },
        "fnHeaderCallback": function(nHead, aData, iStart, iEnd, aiDisplay) {
            nHead.getElementsByTagName('th')[0].innerHTML = '<input type="checkbox" class="storage-volume-check-all"></input>';
            $(".storage-volume-check-all").click(function() {
                $(".storage-volume-check input").each(function() {
                    $(this).prop("checked", $(".storage-volume-check-all").prop("checked"));
                });
            });
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

function init_san_volume_cache_table() {
    $("#san-volume-cache-table").dataTable({
        "aoColumns": [
            {
                "bSortable": false,
                "sClass": "san-volume-cache-check center",
                "mData": null,
                "mRender": function(data, type, full) {
                    return '<input type="checkbox"></input>';
                }
            },
            {
                "sTitle": getText("SAN_TARGET_NAME"),
                "sClass": "san-target-name",
                "mData": "target_name"
            },
            {
                "sTitle": getText("SAN_VOLUME_NAME"),
                "sClass": "san-volume-name",
                "mData": "volume_name"
            },
            {
                "sTitle": getText("CACHE_NAME"),
                "sClass": "san-volume-cache-name",
                "mData": "cache_name"
            },
            {
                "sTitle": getText("CACHE_DEVICE"),
                "sClass": "san-volume-cache-device",
                "mData": "cache_dev"
            }
        ],
        "fnDrawCallback": function(oSettings) {
            update_san_volume_cache_button_status();
            $(".san-volume-cache-check").click(update_san_volume_cache_button_status);
        },
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

function add_sv_tab_osd_enable_osd_click() {

    if ($(this).prop("checked"))
        $("#add_sv_tab_osd_settings").show();
    else
        $("#add_sv_tab_osd_settings").hide();
}

function on_osd_role_enabled(event) {
    if (!g_dashboard.osd_enabled()) {
        g_dashboard.refresh_cluster_info(host_roles_refresh_page);
    }
}

$("#dialog-setup-rackid").on("show.bs.modal", function(e) {
    $("#rack-id").val("");
    ajax_get_rack_aware_status(function(response) {
        $("#rack-id").val(response.rack_id);
    });
});

$("#dialog-setup-rackid").on("shown.bs.modal", function(e) {
    $("#rack-id").focus();
});

$("#rack-id-ok").click(function() {
    ajax_set_rackid(
        $("#rack-id").val(),
        function(response) {
            $("#dialog-setup-rackid").modal('hide');
        }
    );
});

this.init = function(initCompleted) {
    $('#gw-progress').hide();
    $("#gw-reboot").hide();

    $("#dialog-add-storage-volume").on("show.bs.modal", dialog_add_storage_volume_init);
    $("#add-storage-volume-ok").click(dialog_add_storage_volume_ok);
    $("#add_sv_tab_osd_enable_osd").click(add_sv_tab_osd_enable_osd_click);
    $("#add-storage-volume-data-disk").multiselect({
        buttonWidth: '100%',
        onChange: data_disk_change
    });
    $("#add-storage-volume-journal-disk").multiselect({
        buttonWidth: '100%',
        onChange: journal_disk_change
    });
    $("#add-storage-volume-cache-disk").multiselect({
        buttonWidth: '100%',
        allSelectedText: getText("NONE"),  // it's a hack because there's no way to avoid showing all selected text
        onChange: cache_disk_change
    });
    $("#add-storage-volume-spare-disk").multiselect({
        buttonWidth: '100%',
        onChange: spare_disk_change
    });
    $("#add-storage-volume-mode").change(storage_volume_mode_change);
    $("#delete-storage-volume").click(delete_storage_volume);
    $("#dialog-edit-storage-volume").on("show.bs.modal", dialog_edit_storage_volume_init);
    $("#edit-storage-volume-cache-disk").multiselect({
        buttonWidth: '100%',
        allSelectedText: getText("NONE"),
        onChange: edit_cache_disk_change
    });
    $("#edit-storage-volume-spare-disk").multiselect({
        buttonWidth: '100%',
        onChange: edit_spare_disk_change
    });
    $("#edit-storage-volume-ok").click(dialog_edit_storage_volume_ok);
    $("#dialog-repair-storage-volume").on("show.bs.modal", dialog_repair_storage_volume_init);
    $("#dialog-repair-storage-volume").on("shown.bs.modal", dialog_repair_storage_volume_inited);
    $("#repair-storage-volume-ok").click(dialog_repair_storage_volume_ok);
    $("#dialog-enable-osd").on("show.bs.modal", dialog_enable_osd_init);
    $("#enable-osd-ok").click(dialog_enable_osd_ok);
    $("#dialog-disable-osd").on("show.bs.modal", dialog_disable_osd_init);
    $("#dialog-disable-osd").on("shown.bs.modal", dialog_disable_osd_inited);
    $("#disable-osd-ok").click(dialog_disable_osd_ok);
    $("#dialog-change-default-journal").on("show.bs.modal", dialog_change_default_journal_init);
    $("#change-default-journal-ok").click(dialog_change_default_journal_ok);
    $("#default-journal-partition").multiselect({
        buttonWidth: '100%'
    });

    $("#dialog-add-san-volume-cache").on("show.bs.modal", dialog_add_san_volume_cache_init);
    $("#add-san-volume-cache-ok").click(dialog_add_san_volume_cache_ok);
    $("#add-san-volume-lun").multiselect({
        buttonWidth: '100%',
    });
    $("#add-cache-disk").multiselect({
        buttonWidth: '100%',
    });
    $("#delete-san-volume-cache").click(delete_san_volume_cache);

    $("#dialog-enable-fs-cache").on("show.bs.modal", dialog_enable_fs_cache_init);
    $("#enable-fs-cache-ok").click(dialog_enable_fs_cache_ok);
    $("#add-fs-cache-disk").multiselect({
        buttonWidth: '100%',
    });
    $("#add-fs-cache-disk").change(fs_cache_change);
    $("#use-whole-disk-checkbox").on("click", use_whole_disk_checked);
    $("#disable-fs-cache").click(disable_fs_cache);

    $("#dialog-enable-gw").on("show.bs.modal", dialog_enable_gw_init);
    $("#enable-gw-ok").click(dialog_enable_gw_ok);
    $("#disable-gw").click(disable_gw_ok);

    $("#dialog-enable-rrs").on("show.bs.modal", dialog_enable_rrs_init);
    $("#enable-rrs-ok").click(dialog_enable_rrs_ok);
    $("#disable-rrs").click(disable_rrs_ok);
    init_storage_volume_table();
    init_san_volume_cache_table();

    this.refresh_event_id = g_dashboard.register_event_handler(
        'node_management',
        'osd_role_enabled',
        on_osd_role_enabled
    );

    host_roles_refresh_page(false, initCompleted);
};

this.uninit = function() {
    g_dashboard.unregister_event_handler(
        'node_management',
        'osd_role_enabled',
        this.refresh_event_id
    );
    clearTimeout(refreshTimer);
    clearTimeout(osdProgressTimer);
    clearTimeout(gwProgressTimer);
    clearTimeout(rrsProgressTimer);
    $.xhrPool.abortAll();
    $("#storage-volume-table").dataTable().fnDestroy();
    $("#content").remove();
};

};
exports.HostRoles = HostRoles;
}(window));
