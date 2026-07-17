$(function () {
    const $projectList = $('#project-list');
    const $projectCount = $('#project-count');
    const $projectSearch = $('#project-search');
    const $noProjects = $('#no-projects');
    const $projectEmptyState = $('#project-empty-state');
    const $projectEditor = $('#project-editor');
    const $projectName = $('#project-name');
    const $siteCount = $('#site-count');
    const $sites = $('#sites');
    const $sitesEmpty = $('#sites-empty');
    const $save = $('#save');
    const $saveStatus = $('#save-status');
    const $importStatus = $('#import-status');
    const $file = $('#file');

    let sites = [];
    let projectNames = [];
    let selectedProject = null;
    let dirty = false;
    let deletedSite = null;

    function normalise(value) {
        return String(value || '').trim();
    }

    function cleanProjectName(value) {
        return normalise(value).replace(/^[^\p{L}\p{N}]+/u, '').trim();
    }

    function normaliseUrlKey(value) {
        const parsed = parseUrl(value);
        return parsed.valid ? parsed.url.toLowerCase() : normalise(value).replace(/\/$/, '').toLowerCase();
    }

    function cleanAndDeduplicateSites(sourceSites) {
        const seen = new Set();
        const cleaned = [];

        sourceSites.forEach(site => {
            const copy = {
                name: normalise(site.name),
                url: normalise(site.url),
                project: cleanProjectName(site.project),
                icon: normalise(site.icon)
            };
            const key = normaliseUrlKey(copy.url);
            if (key && seen.has(key)) return;
            if (key) seen.add(key);
            cleaned.push(copy);
        });

        return cleaned;
    }

    function escapeCsv(value) {
        return '"' + String(value || '').replace(/"/g, '""') + '"';
    }

    function parseCsv(text) {
        const rows = [];
        let row = [];
        let field = '';
        let quoted = false;

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const next = text[i + 1];

            if (quoted && char === '"' && next === '"') {
                field += '"';
                i++;
            } else if (char === '"') {
                quoted = !quoted;
            } else if (char === ',' && !quoted) {
                row.push(field.trim());
                field = '';
            } else if ((char === '\n' || char === '\r') && !quoted) {
                if (char === '\r' && next === '\n') i++;
                row.push(field.trim());
                field = '';
                if (row.some(value => value !== '')) rows.push(row);
                row = [];
            } else {
                field += char;
            }
        }

        row.push(field.trim());
        if (row.some(value => value !== '')) rows.push(row);
        return rows;
    }

    function makeProjectName(hostname) {
        const parts = hostname.replace(/^www\./i, '').split('.').filter(Boolean);
        const environmentTokens = ['local', 'localhost', 'dev', 'test', 'staging', 'stage', 'uat'];

        if (parts.length === 1) return parts[0];
        if (environmentTokens.includes(parts[parts.length - 1].toLowerCase())) return parts[0];
        if (parts.length > 2 && environmentTokens.includes(parts[0].toLowerCase())) return parts[1];
        return parts[0];
    }

    function makeSiteName(hostname) {
        const cleanHost = hostname.replace(/^www\./i, '');
        const parts = cleanHost.split('.').filter(Boolean);
        const first = (parts[0] || '').toLowerCase();
        const last = (parts[parts.length - 1] || '').toLowerCase();

        if (last === 'local' || hostname === 'localhost') return '-- LOCAL --';
        if (['dev', 'test', 'staging', 'stage', 'uat'].includes(first)) {
            return first === 'stage' ? 'Staging' : first.charAt(0).toUpperCase() + first.slice(1);
        }
        if (parts.slice(1).includes('d3r')) {
            const stagingName = first.split('-').filter(Boolean)[0];
            return stagingName || 'Staging';
        }
        return '-- LIVE --';
    }

    function parseUrl(rawUrl) {
        let value = normalise(rawUrl);
        if (!value) return { valid: false, message: 'Enter a URL.' };
        if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = 'https://' + value;

        try {
            const parsed = new URL(value);
            if (!/^https?:$/.test(parsed.protocol)) {
                return { valid: false, message: 'Use an http or https URL.' };
            }
            return {
                valid: true,
                url: parsed.origin,
                hostname: parsed.hostname.toLowerCase(),
                project: makeProjectName(parsed.hostname.toLowerCase()),
                name: makeSiteName(parsed.hostname.toLowerCase())
            };
        } catch (error) {
            return { valid: false, message: 'This URL does not look valid.' };
        }
    }

    function uniqueProjects() {
        const names = projectNames.concat(sites.map(site => cleanProjectName(site.project))).filter(Boolean);
        return [...new Set(names)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }

    function markDirty(message) {
        dirty = true;
        $save.prop('disabled', false);
        $saveStatus.text(message || 'Unsaved changes').addClass('dirty').removeClass('error');
    }

    function markSaved() {
        dirty = false;
        $save.prop('disabled', true);
        $saveStatus.text('All changes saved').removeClass('dirty error');
        $('.site-row.changed').removeClass('changed');
    }

    function projectSiteCount(project) {
        return sites.filter(site => cleanProjectName(site.project) === project).length;
    }

    function renderProjects() {
        projectNames = uniqueProjects();
        const query = normalise($projectSearch.val()).toLowerCase();
        const filtered = projectNames.filter(name => name.toLowerCase().includes(query));
        $projectList.empty();
        $projectCount.text(projectNames.length);
        $noProjects.prop('hidden', filtered.length !== 0);

        filtered.forEach(project => {
            const $button = $('<button>', {
                type: 'button',
                class: 'project-item' + (project === selectedProject ? ' active' : ''),
                'data-project': project,
                'aria-current': project === selectedProject ? 'true' : null
            });
            $('<span>', { class: 'project-item-name', text: project }).appendTo($button);
            $('<span>', { class: 'project-item-count', text: projectSiteCount(project) }).appendTo($button);
            $projectList.append($button);
        });
    }

    function validateAllRows() {
        let valid = true;
        const seen = new Map();
        const allUrls = sites.map(site => normalise(site.url).toLowerCase()).filter(Boolean);
        allUrls.forEach(url => seen.set(url, (seen.get(url) || 0) + 1));

        $sites.find('.site-row').each(function () {
            const $row = $(this);
            const index = Number($row.attr('data-index'));
            const site = sites[index];
            const parsed = parseUrl(site.url);
            const duplicate = parsed.valid && seen.get(parsed.url.toLowerCase()) > 1;
            const $url = $row.find('[data-field="url"]');
            $row.find('.validation-message').remove();
            $url.removeClass('invalid');
            $row.removeClass('has-error');

            let message = '';
            if (!parsed.valid) message = parsed.message;
            else if (!normalise(site.name)) message = 'Give this site a name.';
            else if (duplicate) message = 'This URL is already used by another site.';

            if (message) {
                valid = false;
                $row.addClass('has-error');
                if (!parsed.valid || duplicate) $url.addClass('invalid');
                $('<div>', { class: 'validation-message', text: message }).appendTo($row);
            }
        });
        return valid;
    }

    function createSiteRow(site, index) {
        const $row = $('<li>', { class: 'site-row', 'data-index': index, role: 'row' });
        $('<button>', { type: 'button', class: 'drag-handle', title: 'Drag to reorder', 'aria-label': 'Drag to reorder', text: '⋮⋮' }).appendTo($row);
        $('<input>', { class: 'site-input', type: 'url', value: site.url || '', placeholder: 'https://example.com', 'data-field': 'url', 'aria-label': 'URL' }).appendTo($row);
        $('<input>', { class: 'site-input', type: 'text', value: site.name || '', placeholder: 'Site name', 'data-field': 'name', 'aria-label': 'Name' }).appendTo($row);
        $('<input>', { class: 'site-input icon-input', type: 'text', value: site.icon || '', placeholder: '↗', maxlength: 4, 'data-field': 'icon', 'aria-label': 'Icon' }).appendTo($row);
        $('<button>', { type: 'button', class: 'delete-site', title: 'Delete site', 'aria-label': 'Delete site', text: '×' }).appendTo($row);
        return $row;
    }

    function renderSites() {
        $sites.empty();
        if (!selectedProject) {
            $projectEmptyState.prop('hidden', false);
            $projectEditor.prop('hidden', true);
            return;
        }

        $projectEmptyState.prop('hidden', true);
        $projectEditor.prop('hidden', false);
        $projectName.val(selectedProject);

        const indices = [];
        sites.forEach((site, index) => {
            if (cleanProjectName(site.project) === selectedProject) indices.push(index);
        });

        indices.forEach(index => $sites.append(createSiteRow(sites[index], index)));
        $siteCount.text(indices.length);
        $sitesEmpty.prop('hidden', indices.length !== 0);
        $('.site-table').prop('hidden', indices.length === 0);

        validateAllRows();
    }

    function selectProject(project) {
        selectedProject = project;
        renderProjects();
        renderSites();
    }

    function addProject() {
        let base = 'New project';
        let name = base;
        let number = 2;
        const existing = uniqueProjects().map(project => project.toLowerCase());
        while (existing.includes(name.toLowerCase())) name = base + ' ' + number++;
        projectNames.push(name);
        selectProject(name);
        markDirty('New project not yet saved');
        setTimeout(() => $projectName.trigger('focus').trigger('select'), 0);
    }

    function addSite() {
        if (!selectedProject) return;
        sites.push({ name: '', url: '', project: selectedProject, icon: '' });
        renderProjects();
        renderSites();
        markDirty();
        setTimeout(() => $sites.find('.site-row:last [data-field="url"]').trigger('focus'), 0);
    }

    function removeEmptySites() {
        sites = sites.filter(site => normalise(site.name) || normalise(site.url));
    }

    chrome.storage.local.get({ sites: [] }, function (data) {
        const originalSites = Array.isArray(data.sites) ? data.sites : [];
        sites = cleanAndDeduplicateSites(originalSites);

        const changed = JSON.stringify(sites) !== JSON.stringify(originalSites.map(site => ({
            name: site.name || '',
            url: site.url || '',
            project: site.project || '',
            icon: site.icon || ''
        })));
        if (changed) chrome.storage.local.set({ sites: sites });

        projectNames = uniqueProjects();
        renderProjects();
        if (projectNames.length) selectProject(projectNames[0]);
    });

    $projectSearch.on('input', renderProjects);

    $projectList.on('click', '.project-item', function () {
        selectProject($(this).attr('data-project'));
    });

    $('#add-project').on('click', addProject);
    $('#add-site, #add-first-site').on('click', addSite);

    $projectName.on('input', function () {
        const newName = cleanProjectName($(this).val());
        if (!selectedProject) return;
        sites.forEach(site => {
            if (cleanProjectName(site.project) === selectedProject) site.project = newName;
        });
        const position = projectNames.indexOf(selectedProject);
        if (position !== -1) projectNames[position] = newName;
        selectedProject = newName;
        renderProjects();
        markDirty();
    });

    $projectName.on('blur', function () {
        const cleaned = cleanProjectName($(this).val());
        if (!cleaned) {
            $(this).val(selectedProject || 'New project');
            return;
        }
        const clash = uniqueProjects().some(project => project !== selectedProject && project.toLowerCase() === cleaned.toLowerCase());
        if (clash) {
            $saveStatus.text('A project with that name already exists').addClass('error');
            $(this).addClass('invalid').trigger('focus');
            return;
        }
        $(this).removeClass('invalid');
        if (cleaned !== selectedProject) {
            sites.forEach(site => {
                if (cleanProjectName(site.project) === selectedProject) site.project = cleaned;
            });
            const position = projectNames.indexOf(selectedProject);
            if (position !== -1) projectNames[position] = cleaned;
            selectedProject = cleaned;
            $(this).val(cleaned);
            renderProjects();
            markDirty();
        }
    });

    $sites.on('input', '.site-input', function () {
        const $input = $(this);
        const $row = $input.closest('.site-row');
        const index = Number($row.attr('data-index'));
        const field = $input.attr('data-field');
        sites[index][field] = $input.val();
        $row.addClass('changed');
        markDirty();
        validateAllRows();
    });

    $sites.on('blur', '[data-field="url"]', function () {
        const $input = $(this);
        const $row = $input.closest('.site-row');
        const index = Number($row.attr('data-index'));
        const site = sites[index];
        const parsed = parseUrl($input.val());
        if (!parsed.valid) {
            validateAllRows();
            return;
        }

        site.url = parsed.url;
        $input.val(parsed.url);
        if (!normalise(site.name)) {
            site.name = parsed.name;
            $row.find('[data-field="name"]').val(parsed.name);
        }

        if (projectSiteCount(selectedProject) === 1 && /^New project(?: \d+)?$/.test(selectedProject)) {
            const oldProject = selectedProject;
            const suggested = parsed.project.charAt(0).toUpperCase() + parsed.project.slice(1);
            if (suggested && !uniqueProjects().some(project => project !== oldProject && project.toLowerCase() === suggested.toLowerCase())) {
                site.project = suggested;
                selectedProject = suggested;
                const position = projectNames.indexOf(oldProject);
                if (position !== -1) projectNames[position] = suggested;
                $projectName.val(suggested);
                renderProjects();
            }
        }
        markDirty();
        validateAllRows();
    });

    $sites.on('keydown', '.site-input', function (event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            addSite();
        }
    });

    $sites.on('click', '.delete-site', function () {
        const $row = $(this).closest('.site-row');
        const index = Number($row.attr('data-index'));
        deletedSite = { site: sites[index], index: index };
        sites.splice(index, 1);
        renderProjects();
        renderSites();
        markDirty('Site deleted. Save to confirm.');
    });

    let draggedRow = null;

    function saveDisplayedSiteOrder() {
        const orderedIndices = $sites.children('.site-row').map(function () {
            return Number($(this).attr('data-index'));
        }).get();
        const selectedSites = orderedIndices.map(index => sites[index]);
        let selectedCursor = 0;
        sites = sites.map(site => cleanProjectName(site.project) === selectedProject ? selectedSites[selectedCursor++] : site);
        renderSites();
        markDirty('Site order changed');
    }

    // Native drag-and-drop is more reliable here than jQuery UI in extension pages,
    // and works in both Chrome and Firefox Developer Edition.
    $sites.on('pointerdown mousedown', '.drag-handle', function () {
        $(this).closest('.site-row').attr('draggable', 'true');
    });

    $sites.on('dragstart', '.site-row', function (event) {
        if ($(event.target).attr('draggable') !== 'true') {
            event.preventDefault();
            return;
        }
        draggedRow = this;
        $(this).addClass('dragging');
        const transfer = event.originalEvent.dataTransfer;
        transfer.effectAllowed = 'move';
        // Firefox requires data to be set before it will start a drag operation.
        transfer.setData('text/plain', $(this).attr('data-index'));
    });

    $sites.on('dragover', '.site-row', function (event) {
        if (!draggedRow || this === draggedRow) return;
        event.preventDefault();
        event.originalEvent.dataTransfer.dropEffect = 'move';
        const rect = this.getBoundingClientRect();
        const insertAfter = event.originalEvent.clientY > rect.top + rect.height / 2;
        if (insertAfter) this.after(draggedRow);
        else this.before(draggedRow);
    });

    $sites.on('dragover', function (event) {
        if (draggedRow) event.preventDefault();
    });

    $sites.on('drop', function (event) {
        if (draggedRow) event.preventDefault();
    });

    $sites.on('dragend', '.site-row', function () {
        const moved = draggedRow === this;
        $(this).removeClass('dragging').removeAttr('draggable');
        draggedRow = null;
        if (moved) saveDisplayedSiteOrder();
    });

    $sites.on('pointerup mouseup', '.drag-handle', function () {
        if (!draggedRow) $(this).closest('.site-row').removeAttr('draggable');
    });

    function siteSortGroup(site) {
        const name = normalise(site.name).toLowerCase();
        const url = normalise(site.url).toLowerCase();
        const isLocal = /\blocal\b/.test(name) || /localhost|\.local(?::|\/|$)/.test(url);
        const isLive = /\blive\b/.test(name);
        const isStaging = /d3r|staging|stage|\buat\b|\bdev\b|\btest\b/.test(name + ' ' + url);
        if (isLocal) return 0;
        if (isLive) return 1;
        if (!isStaging) return 2;
        return 3;
    }

    $('#sort').on('click', function () {
        const selected = sites.filter(site => cleanProjectName(site.project) === selectedProject);
        selected.sort((a, b) => {
            const groupDifference = siteSortGroup(a) - siteSortGroup(b);
            if (groupDifference) return groupDifference;
            const nameDifference = normalise(a.name).localeCompare(normalise(b.name), undefined, { sensitivity: 'base' });
            if (nameDifference) return nameDifference;
            return normalise(a.url).localeCompare(normalise(b.url), undefined, { sensitivity: 'base' });
        });
        let cursor = 0;
        sites = sites.map(site => cleanProjectName(site.project) === selectedProject ? selected[cursor++] : site);
        renderSites();
        markDirty('Sites sorted: local, live, then staging');
    });

    $('#delete-project').on('click', function () {
        if (!selectedProject) return;
        const count = projectSiteCount(selectedProject);
        const message = count
            ? `Delete “${selectedProject}” and its ${count} site${count === 1 ? '' : 's'}?`
            : `Delete “${selectedProject}”?`;
        if (!window.confirm(message)) return;

        sites = sites.filter(site => cleanProjectName(site.project) !== selectedProject);
        projectNames = projectNames.filter(project => project !== selectedProject);
        const nextProjects = uniqueProjects();
        selectedProject = nextProjects[0] || null;
        renderProjects();
        renderSites();
        markDirty('Project deleted. Save to confirm.');
    });

    $save.on('click', function () {
        removeEmptySites();
        sites = cleanAndDeduplicateSites(sites);
        if (!validateAllRows()) {
            $saveStatus.text('Fix the highlighted sites before saving').addClass('error');
            return;
        }
        if (!normalise($projectName.val()) && selectedProject) {
            $saveStatus.text('Project name cannot be empty').addClass('error');
            return;
        }

        $save.prop('disabled', true).text('Saving…');
        chrome.storage.local.set({ sites: sites }, function () {
            $save.text('Save changes');
            if (chrome.runtime.lastError) {
                $save.prop('disabled', false);
                $saveStatus.text('Could not save changes').addClass('error');
                return;
            }
            projectNames = uniqueProjects();
            renderProjects();
            renderSites();
            markSaved();
        });
    });

    $file.on('change', function () {
        const file = this.files && this.files[0];
        if (!file) return;
        const reader = new FileReader();

        reader.onload = function (event) {
            const rows = parseCsv(event.target.result);
            const byUrl = new Map();
            sites.forEach((site, index) => byUrl.set(normalise(site.url).replace(/\/$/, '').toLowerCase(), index));
            let added = 0;
                        let skipped = 0;

            rows.forEach(values => {
                if (values.length < 2) { skipped++; return; }
                const name = normalise(values[0]);
                const parsed = parseUrl(values[1]);
                const project = cleanProjectName(values[2]);
                const icon = normalise(values[3]);
                if (!name || !parsed.valid) { skipped++; return; }

                const site = { name, url: parsed.url, project, icon };
                const key = parsed.url.toLowerCase();
                if (byUrl.has(key)) {
                    skipped++;
                    return;
                }
                byUrl.set(key, sites.length);
                sites.push(site);
                added++;
            });

            projectNames = uniqueProjects();
            if (!selectedProject && projectNames.length) selectedProject = projectNames[0];
            renderProjects();
            renderSites();
            markDirty();
            $importStatus.removeClass('error').text(`${added} added${skipped ? `, ${skipped} skipped (invalid or duplicate)` : ''}. Save changes to finish.`);
            $file.val('');
        };

        reader.onerror = function () {
            $importStatus.addClass('error').text('The CSV file could not be read.');
            $file.val('');
        };
        reader.readAsText(file);
    });

    $('#export').on('click', function () {
        removeEmptySites();
        const csv = sites.map(site => [site.name, site.url, site.project, site.icon].map(escapeCsv).join(', ')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const date = new Date();
        const stamp = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
        const anchor = document.createElement('a');
        anchor.href = URL.createObjectURL(blob);
        anchor.download = `switcher-sites-${stamp}.csv`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
    });

    window.addEventListener('beforeunload', function (event) {
        if (!dirty) return;
        event.preventDefault();
        event.returnValue = '';
    });
});
