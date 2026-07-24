if (!String.prototype.hasOwnProperty('ucFirst')) {
    Object.defineProperty(String.prototype, 'ucFirst', {
        value: function() {
            var s = this.toString();
            return s[0].toUpperCase() + s.substring(1);
        }
    });
}

if (!String.prototype.hasOwnProperty('ucWords')) {
    Object.defineProperty(String.prototype, 'ucWords', {
        value: function() {
            var string = this.toString();
            const words = string.split(" ");

            for (let i = 0; i < words.length; i++) {
                words[i] = words[i][0].toUpperCase() + words[i].substring(1);
            }

            return words.join(" ");
        }
    });
}


function projectKey(value) {
    return String(value || '').replace(/^\s+|\s+$/g, '').replace(/\s+/g, '').toLowerCase();
}

function cleanProjectName(value) {
    return String(value || '').trim().replace(/^[^\p{L}\p{N}]+/u, '').trim();
}

function findCanonicalProject(project, sites) {
    var key = projectKey(project);
    var match = sites.find(function(site) { return projectKey(site.project) === key; });
    return match ? cleanProjectName(match.project) : cleanProjectName(project);
}

function inferCurrentSite(link, sites) {
    var hostname = link.hostname.toLowerCase();
    var labels = hostname.replace(/^www\./, '').split('.').filter(Boolean);
    var first = labels[0] || '';
    var name = '-- LIVE --';
    var project = first;
    var icon = '⚡️';

    if (hostname === 'localhost' || labels[labels.length - 1] === 'local') {
        name = '-- LOCAL --';
        project = first;
        icon = '💻';
    } else if (labels.slice(1).includes('d3r')) {
        var hostParts = first.split('-').filter(Boolean);
        name = hostParts.shift() || 'Staging';
        if (hostParts.length > 1) hostParts.pop();
        project = hostParts.join(' ') || project;
        icon = '👁️';
    }

    project = findCanonicalProject(project, sites);
    if (!project) project = 'Other';

    return {
        name: name === '-- LIVE --' || name === '-- LOCAL --' ? name : name.ucWords(),
        url: link.origin,
        project: project,
        icon: icon
    };
}


function classifySite(site) {
    var name = (site.name || '').toLowerCase();
    var url = (site.url || '').toLowerCase();

    if (name.indexOf('local') > -1 || url.indexOf('.local') > -1 || url.indexOf('localhost') > -1) {
        return 'primary';
    }
    if (name.indexOf('live') > -1) {
        return 'primary';
    }
    if (url.indexOf('.d3r.') > -1 || /\b(staging|stage|dev|test|uat|qa|preview)\b/.test(name + ' ' + url)) {
        return 'staging';
    }
    return 'other';
}

function renderProjectSites(client, $sites, query) {
    query = (query || '').trim().toLowerCase();
    $sites.find('.site-divider').remove();
    $sites.find('.site-row').removeClass('show');

    var groups = [
        {key: 'primary', label: ''},
        {key: 'other', label: 'Other'},
        {key: 'staging', label: 'Staging'}
    ];

    // Re-append visible rows in group order. This keeps every Local/Live row
    // above the Staging divider even when the stored site order is mixed.
    groups.forEach(function(group) {
        var $rows = $sites.find('.site-row').filter(function() {
            if ($(this).data('client') != client || $(this).data('group') != group.key) return false;
            if (!query || group.key === 'primary') return true;
            return String($(this).data('search') || '').indexOf(query) > -1;
        });

        if (!$rows.length) return;

        if (group.label) {
            $('<li>', {
                'class': 'site-divider show',
                text: group.label
            }).appendTo($sites);
        }

        $rows.detach().addClass('show').appendTo($sites);
    });
}


$(document).ready(function() {
    var manifest = chrome.runtime.getManifest();
    $('#version').text('v' + manifest.version);

    chrome.tabs.query({currentWindow: true, active: true}, function(tabs) {
        chrome.storage.local.get({sites: []}, function(data) {
            if (!data) {
                data = {sites: []};
            }

            if (data.sites.length > 0) {
                var projects = {};
                var projectNamesByKey = {};
                var selected_project;
                var selected_site;

                data.sites.forEach(function(site) {
                    var rawProject = cleanProjectName(site.project) || 'undefined';
                    var key = projectKey(rawProject);
                    var project = projectNamesByKey[key] || rawProject;
                    projectNamesByKey[key] = project;
                    site.project = project;

                    if (projects[project] === undefined) {
                        projects[project] = [];
                    }
                    projects[project].push(site);
                });

                var current = tabs[0].url;

                var link = new URL(current);
                var domain = link.hostname;
                var origin = link.origin;

                var $projects = $('#projects');
                var $sites  = $('#sites');
                var $siteSearch = $('#site-search');

                Object.keys(projects)
                    .sort(function(a, b) { return a.localeCompare(b, undefined, {sensitivity: 'base'}); })
                    .forEach(function(project) {
                    $('<option value="' + escape(project) + '">' + project + '</option>').appendTo($projects);

                    for (var s in projects[project]) {
                        var site = projects[project][s];
                        var selected = '';
                        var url = site.url;
                        if (url.indexOf('//') > -1) {
                            url = url.split('//')[1];
                        }

                        if (url.indexOf(domain) == 0) {
                            selected_project = project;
                            selected_site = site;

                            selected = ' class="selected"';
                        }

                        if (!site.icon) {
                            site.icon = '⚡️';

                            if (url.indexOf('.d3r.com') > -1) {
                                site.icon = '👁️';
                            }
                            if (url.indexOf('.local') > -1) {
                                site.icon = '💻';
                            }
                        }

                        var group = classifySite(site);
                        var $row = $('<li>', {
                            'class': 'site-row' + (selected ? ' selected' : ''),
                            'data-client': escape(project),
                            'data-group': group,
                            'data-search': ((site.name || '') + ' ' + (site.url || '')).toLowerCase()
                        });
                        var $link = $('<a>', {
                            href: site.url + link.pathname + link.search,
                            title: site.name
                        });
                        $('<span>', {'class': 'site-icon', text: site.icon}).appendTo($link);
                        $('<span>', {'class': 'site-name', text: site.name}).appendTo($link);
                        $('<svg viewBox="0 0 24 24" aria-hidden="true" class="site-open"><path d="M14 3h7v7h-2V6.4l-9.3 9.3-1.4-1.4L17.6 5H14V3ZM5 5h6v2H7v10h10v-4h2v6H5V5Z"/></svg>').appendTo($link);
                        $row.append($link).appendTo($sites);
                    }
                });

                function updateSiteSearch(project, focusSearch) {
                    var count = $sites.find('.site-row').filter(function() {
                        return $(this).data('client') == project;
                    }).length;
                    var shouldShow = count > 8;
                    $siteSearch.prop('hidden', !shouldShow);
                    if (!shouldShow) {
                        $siteSearch.val('');
                        return;
                    }

                    if (focusSearch) {
                        // Popup focus can settle a fraction late in both Chrome and Firefox.
                        // Focusing on the next paint, then once more shortly afterwards, is reliable.
                        requestAnimationFrame(function() {
                            $siteSearch[0].focus();
                            setTimeout(function() { $siteSearch[0].focus(); }, 40);
                        });
                    }
                }

                $projects.on('change', function() {
                    $siteSearch.val('');
                    updateSiteSearch($projects.val(), true);
                    renderProjectSites($projects.val(), $sites, '');
                });

                $siteSearch.on('input', function() {
                    renderProjectSites($projects.val(), $sites, $(this).val());
                });

                if (selected_project) {
                    $projects.val(escape(selected_project)).trigger('change');
                } else {
                    var $add = $('#add');
                    $add.css('display', 'block');

                    $add.on('click', function(e) {
                        e.preventDefault();

                        var duplicate = data.sites.some(function(site) {
                            return String(site.url || '').replace(/\/$/, '').toLowerCase() === origin.replace(/\/$/, '').toLowerCase();
                        });
                        if (duplicate) {
                            $add.text('Site already added').prop('disabled', true);
                            return;
                        }

                        var site = inferCurrentSite(link, data.sites);
                        data.sites.push(site);
                        $add.text('Adding…').prop('disabled', true);
                        chrome.storage.local.set({sites: data.sites}, function() {
                            $add.text('Site added');
                            setTimeout(function() { window.location.reload(); }, 250);
                        });
                    });
                }

                if ($projects.find('option').length <= 2) {
                    $projects.hide();

                    if (!selected_project) {
                        $sites.find('li').addClass('show');
                    }
                }

                $('#debug a').on('click', function(e) {
                    const debugLink = link;
                    const linkQueryParams = new URLSearchParams(debugLink.search);
                    linkQueryParams.set('d3r_debug', this.dataset.debug);
                    debugLink.search = linkQueryParams.toString();
                    chrome.tabs.update(tabs[0].id, {url: debugLink.toString()});
                    window.close();
                });

                var $edit = $('#edit');
                if (link.pathname.indexOf('/cp') > -1) {
                    $edit.hide();
                } else {
                    $edit.attr('href', link.protocol + '//' + link.hostname + '/cp' + link.pathname);
                }

                if (navigator.userAgent.indexOf('Firefox') == -1) {
                    $('#sites').on('click', 'a', function() {
                        chrome.tabs.create({'url': this.href});
                    });
                }

                $('#edit').on('click', function(e) {
                    e.preventDefault();
                    chrome.tabs.create({'url': this.href});
                    window.close();
                });

                $('#options').on('click', function() {
                    chrome.runtime.openOptionsPage();
                });
            } else {
                chrome.runtime.openOptionsPage();
            }
        });
    });
});
