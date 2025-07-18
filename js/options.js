if (!String.prototype.hasOwnProperty('ucFirst')) {
    Object.defineProperty(String.prototype, 'ucFirst', {
        value: function() {
            var s = this.toString();
            return s[0].toUpperCase() + s.substring(1);
        }
    });
};

$(function () {
    var $projects = $('#projects');
    var $save     = $('#save');
    var $sort     = $('#sort');
    var $file     = $('#file');
    var $export   = $('#export');
    var $sites    = $('#sites');
    var sites     = [];

    function getSites() {
        sites = [];
        $('li').each(function() {
            var name    = $(this).find('input[name="name"]').val();
            var url     = $(this).find('input[name="url"]').val();
            var project = $(this).find('input[name="project"]').val();
            var icon    = $(this).find('input[name="icon"]').val();

            if (name != '' && url != '') {
                var site = {
                    'name'    : name,
                    'url'     : url,
                    'project' : project,
                    'icon'    : icon,
                };

                sites.push(site);
            }
        });

        refreshProjects();
    }

    function row(name, url, project, icon) {
        var blank = (name == '') ? ' class="blank"' : '';
        return '<li' + blank + '><img src="/images/sort.png"> <input title="Icon" placeholder="&gt;" name="icon" value="' + icon + '"> <input placeholder="name" name="name" value="' + name + '"><input placeholder="url" name="url" value="' + url + '"><input placeholder="project" name="project" value="' + project + '"></li>';
    }

    function nameSort(name) {
        // this is a bit hacky :/

        if (name.toUpperCase().indexOf('LOCAL') > -1) {
            return '   ';
        }

        if (name.toUpperCase().indexOf('LIVE') > -1) {
            return 'ZZZ';
        }

        return name;
    }

    function refreshProjects() {
        var projects = [];
        var options = ['<option value="">-- project filter --</option>'];

        var $lis = $sites.find('li');

        $lis.each(function() {
            var $li = $(this);
            var project = $li.find('input:eq(3)').val();

            if (project && projects.indexOf(project) == -1) {
                projects.push(project);
                options.push(`<option value="${project}">${project}</option>`);
            }
        });

        $projects.html(options.join("\n"));
    }

    chrome.storage.local.get({sites: []}, function(data) {
        var lis = [];
        data.sites.forEach(function(site) {
            lis.push(row(site.name, site.url, site.project, site.icon || ''));
        });

        lis.push(row('', '', '', ''));

        $sites.html(lis.join("\n"));

        refreshProjects();
    });

    $projects.on('change', function(e) {
        var filter = $(this).val();

        var $lis = $sites.find('li');
        if (!filter) {
            $lis.show();
            return;
        }

        $lis.each(function() {
            var $li = $(this);
            var project = $li.find('input:eq(3)').val();
            var show = (project == '' || project == filter);

            if (show) {
                $li.show();
            } else {
                $li.hide();
            }
        });
    });

    $sites.sortable({
        change: function(event, ui) {
            $save.trigger('_enable');
        }
    });

    $sites.on('input paste', 'input', function() {
        var $input = $(this);
        var $li = $input.closest('li');

        $li.addClass('changed');

        if ($li.hasClass('blank')) {
            $li.removeClass('blank');
            $(row('', '', '')).appendTo($sites);
        }

        $save.trigger('_enable');
    });

    $sites.on('change paste', 'input[name="url"]', function(e) {
        e.preventDefault();

        var $input = $(this);
        var $li = $input.closest('li');
        var url = $input.val();

        if (e.type == 'paste') {
            url = e.originalEvent.clipboardData.getData('text');
        }

        if (url == '') {
            $input.val('');
            return;
        }

        var link = new URL(url);
        url = link.origin;

        $input.val(url);

        if (domain.indexOf('www') == 0 || (domain.indexOf('d3r') == -1 && domain.indexOf('local') == -1)) {
            parts = domain.split('.');
            parts[0] = '-- LIVE --';
        }

        if (domain.indexOf('d3r') == -1 && domain.indexOf('local') == -1) {
            parts = domain.split('.');
            if (parts[0] == 'www') {
                parts.shift();
            }
            parts.unshift('-- LIVE --');

        }

        if (domain.indexOf('local') > -1) {
            parts = domain.split('.');
            parts[0] = '-- LOCAL --';
        }

        if (parts.length > 1) {
            var $name = $li.find('input[name="name"]');
            if ($name.val() == '') {
                $name.val(parts[0].ucFirst());
            }

            var $project = $li.find('input[name="project"]');
            if ($project.val() == '') {
                $project.val(parts[1].ucFirst());
            }
        }
    });

    $save.on('_enable', function(e) {
        $save.html('SAVE').removeClass('disabled');
    });

    $save.on('_disable', function(e) {
        $save.html('saved').addClass('disabled');
        $('li.changed').removeClass('changed');
    });

    $save.on('click', function(e) {
        e.preventDefault();
        getSites();

        chrome.storage.local.set({sites: sites}, function() {
            $save.trigger('_disable');
        });
    });

    $sort.on('click', function(e) {
        e.preventDefault();

        getSites();

        sites.sort(function(a, b) {
            if (a.project < b.project) {
                return -1;
            }

            if (a.project > b.project) {
                return 1;
            }

            if (nameSort(a.name) < nameSort(b.name)) {
                return -1;
            }

            if (nameSort(a.name) > nameSort(b.name)) {
                return 1;
            }

            return 0;
        });

        var lis = [];
        sites.forEach(function(site) {
            lis.push(row(site.name, site.url, site.project, site.icon));
        });

        lis.push(row('', '', ''));

        $sites.html(lis.join("\n"));

        $sites.find('li').addClass('changed');
        $save.trigger('_enable');
    });

    $file.on('change', function(e) {
        var file = this.files[0];

        var reader = new FileReader();
        reader.onload = function(e) {
            getSites();

            var exists = [];
            sites.forEach(function(site) {
                exists.push(site.url);
            });

            var lines = e.target.result.split("\n");

            lines.forEach(function(line) {
                var values = line.split(/", *"/);

                if (values.length > 1) {
                    if (values.length < 3) {
                        values.push('');
                    }

                    var name    = values[0].replace('"', '');
                    var url     = values[1].replace('"', '');
                    var project = values[2].replace('"', '');
                    var icon    = values[3].replace('"', '');

                    url = url.replace(/\/$/, '');

                    if (exists.indexOf(url) == -1) {
                        $(row(name, url, project)).insertBefore('li.blank');
                    }
                }
            });

            $save.trigger('_enable');
        }

        reader.readAsText(file);
    });

    $export.on('click', function(e) {
        e.preventDefault();
        getSites();

        var lines = [];
        sites.forEach(function(site) {
            lines.push('"' + site.name + '", "' + site.url + '", "' + site.project + '"');
        });

        var csv = lines.join("\n");

        chrome.downloads.download({
            'url': encodeURI('data:text/csv,' + csv),
            'filename': 'sites.csv'
        });
    });
});
