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
    const $save = $('.save-button');
    const $saveStatus = $('#save-status');
    const $importStatus = $('#import-status');
    const $file = $('#file');

    let sites = [];
    let projectNames = [];
    let selectedProject = null;
    let dirty = false;
    let deletedSite = null;
    let singleProjectMode = null;

    function normalise(value) {
        return String(value || '').trim();
    }

    function cleanProjectName(value) {
        return normalise(value).replace(/^[^\p{L}\p{N}]+/u, '').trim();
    }

    function projectKey(value) {
        return cleanProjectName(value).replace(/\s+/g, '').toLowerCase();
    }

    function sameProject(a, b) {
        return projectKey(a) === projectKey(b);
    }

    function canonicalProjectName(value) {
        const key = projectKey(value);
        if (!key) return '';
        const existing = projectNames.concat(sites.filter(Boolean).map(site => cleanProjectName(site.project)))
            .find(name => projectKey(name) === key);
        return existing ? cleanProjectName(existing) : cleanProjectName(value);
    }

    function normaliseUrlKey(value) {
        const parsed = parseUrl(value);
        return parsed.valid ? parsed.url.toLowerCase() : normalise(value).replace(/\/$/, '').toLowerCase();
    }

    function cleanAndDeduplicateSites(sourceSites) {
        const seenUrls = new Set();
        const canonicalProjects = new Map();
        const cleaned = [];

        (Array.isArray(sourceSites) ? sourceSites : []).forEach(site => {
            if (!site || typeof site !== 'object') return;
            const rawProject = cleanProjectName(site.project);
            const key = projectKey(rawProject);
            if (key && !canonicalProjects.has(key)) canonicalProjects.set(key, rawProject);

            const copy = {
                name: normalise(site.name),
                url: normalise(site.url),
                project: key ? canonicalProjects.get(key) : '',
                icon: normalise(site.icon)
            };
            const urlKey = normaliseUrlKey(copy.url);
            if (urlKey && seenUrls.has(urlKey)) return;
            if (urlKey) seenUrls.add(urlKey);
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

        if (parts.slice(1).includes('d3r')) {
            const hostParts = (parts[0] || '').split('-').filter(Boolean);
            if (hostParts.length > 2) return hostParts.slice(1, -1).join(' ');
            if (hostParts.length > 1) return hostParts.slice(1).join(' ');
        }
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
        const canonical = new Map();
        projectNames.concat(sites.filter(Boolean).map(site => cleanProjectName(site.project))).filter(Boolean).forEach(name => {
            const key = projectKey(name);
            if (key && !canonical.has(key)) canonical.set(key, cleanProjectName(name));
        });
        return [...canonical.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }

    function resolveSingleProjectMode() {
        const projects = uniqueProjects();
        const override = localStorage.getItem('singleProject');
        if (override) {
            const match = projects.find(project => sameProject(project, override));
            if (match) return match;
        }
        return projects.length === 1 ? projects[0] : null;
    }

    function applySingleProjectMode() {
        singleProjectMode = resolveSingleProjectMode();
        document.body.classList.toggle('single-project-mode', Boolean(singleProjectMode));
        if (singleProjectMode && !sameProject(selectedProject, singleProjectMode)) {
            selectedProject = singleProjectMode;
        }
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
        return sites.filter(site => site && sameProject(site.project, project)).length;
    }

    function renderProjects() {
        projectNames = uniqueProjects();
        applySingleProjectMode();
        const query = projectKey($projectSearch.val());
        const filtered = projectNames.filter(name =>
            (!singleProjectMode || sameProject(name, singleProjectMode)) && projectKey(name).includes(query)
        );
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
        const allUrls = sites.filter(Boolean).map(site => normalise(site.url).toLowerCase()).filter(Boolean);
        allUrls.forEach(url => seen.set(url, (seen.get(url) || 0) + 1));

        $sites.find('.site-row').each(function () {
            const $row = $(this);
            const index = Number($row.attr('data-index'));
            const site = sites[index];
            if (!site) {
                $row.remove();
                return;
            }
            const shorthand = getStagingSuggestion(site.url, index);
            const parsed = shorthand ? { valid: false, message: 'Press Enter to complete this staging URL.' } : parseUrl(site.url);
            const duplicate = parsed.valid && seen.get(parsed.url.toLowerCase()) > 1;
            const $url = $row.find('[data-field="url"]');
            $row.find('.validation-message').remove();
            $url.removeClass('invalid');
            $row.removeClass('has-error');

            if (shorthand) {
                valid = false;
                return;
            }

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
        $('<input>', { class: 'site-input', type: 'text', inputmode: 'url', value: site.url || '', placeholder: 'URL or staging name', 'data-field': 'url', 'aria-label': 'URL', autocomplete: 'off' }).appendTo($row);
        $('<input>', { class: 'site-input', type: 'text', value: site.name || '', placeholder: 'Site name', 'data-field': 'name', 'aria-label': 'Name' }).appendTo($row);
        $('<input>', { class: 'site-input icon-input', type: 'text', value: site.icon || '', placeholder: '↗', maxlength: 4, 'data-field': 'icon', 'aria-label': 'Icon' }).appendTo($row);
        $('<button>', { type: 'button', class: 'delete-site', title: 'Delete site', 'aria-label': 'Delete site', text: '×' }).appendTo($row);
        $('<div>', { class: 'url-suggestion', hidden: true, 'aria-live': 'polite' }).appendTo($row);
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
            if (sameProject(site.project, selectedProject)) indices.push(index);
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
        const existing = uniqueProjects().map(project => projectKey(project));
        while (existing.includes(projectKey(name))) name = base + ' ' + number++;
        projectNames.push(name);
        selectProject(name);
        markDirty('New project not yet saved');
        setTimeout(() => $projectName.trigger('focus').trigger('select'), 0);
    }

    function addSite() {
        if (!selectedProject) return;

        const existingBlankIndex = sites.findIndex(site =>
            sameProject(site.project, selectedProject) &&
            !normalise(site.url) &&
            !normalise(site.name)
        );

        if (existingBlankIndex !== -1) {
            const $existing = $sites.find(`.site-row[data-index="${existingBlankIndex}"] [data-field="url"]`);
            if ($existing.length) {
                $existing.trigger('focus')[0].scrollIntoView({ block: 'nearest' });
                return;
            }
        }

        sites.push({ name: '', url: '', project: selectedProject, icon: '' });
        renderProjects();
        renderSites();
        markDirty();
        setTimeout(() => {
            const $input = $sites.find('.site-row:last [data-field="url"]');
            $input.trigger('focus');
            if ($input.length) $input[0].scrollIntoView({ block: 'nearest' });
        }, 0);
    }

    function removeEmptySites() {
        sites = sites.filter(site => normalise(site.name) || normalise(site.url));
    }

    chrome.storage.local.get({ sites: [], advancedMode: false }, function (data) {
        $('#advanced-mode-badge').prop('hidden', !data.advancedMode);
        const originalSites = Array.isArray(data.sites) ? data.sites : [];
        sites = cleanAndDeduplicateSites(originalSites);

        const comparableOriginal = originalSites
            .filter(site => site && typeof site === 'object')
            .map(site => ({
                name: site.name || '',
                url: site.url || '',
                project: site.project || '',
                icon: site.icon || ''
            }));
        const changed = JSON.stringify(sites) !== JSON.stringify(comparableOriginal);
        if (changed) chrome.storage.local.set({ sites: sites });

        projectNames = uniqueProjects();
        applySingleProjectMode();
        renderProjects();
        if (singleProjectMode) selectProject(singleProjectMode);
        else if (projectNames.length) selectProject(projectNames[0]);
    });

    // Hidden global developer toggle. Advanced mode applies to the entire extension.
    $(document).on('keydown', function (event) {
        if (!(event.metaKey && event.shiftKey && String(event.key).toLowerCase() === 'd')) return;
        event.preventDefault();
        chrome.storage.local.get({ advancedMode: false }, function (data) {
            const enabled = !Boolean(data.advancedMode);
            chrome.storage.local.set({ advancedMode: enabled }, function () {
                $('#advanced-mode-badge').prop('hidden', !enabled);
                $saveStatus
                    .text('Advanced mode ' + (enabled ? 'enabled' : 'disabled'))
                    .removeClass('dirty error');
            });
        });
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
            if (site && sameProject(site.project, selectedProject)) site.project = newName;
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
        const clash = uniqueProjects().some(project => project !== selectedProject && projectKey(project) === projectKey(cleaned));
        if (clash) {
            $saveStatus.text('A project with that name already exists').addClass('error');
            $(this).addClass('invalid').trigger('focus');
            return;
        }
        $(this).removeClass('invalid');
        if (cleaned !== selectedProject) {
            sites.forEach(site => {
                if (sameProject(site.project, selectedProject)) site.project = cleaned;
            });
            const position = projectNames.indexOf(selectedProject);
            if (position !== -1) projectNames[position] = cleaned;
            selectedProject = cleaned;
            $(this).val(cleaned);
            renderProjects();
            markDirty();
        }
    });

    function getStagingSuggestion(rawValue, index) {
        const value = normalise(rawValue).toLowerCase();
        const template = inferStagingTemplate(selectedProject);
        if (!template || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) return null;

        const parsed = parseUrl(template.replaceAll('{slug}', value));
        if (!parsed.valid) return null;

        const key = normaliseUrlKey(parsed.url);
        const duplicate = sites.some((site, siteIndex) => siteIndex !== index && normaliseUrlKey(site.url) === key);
        return { slug: value, name: value, url: parsed.url, duplicate: duplicate };
    }

    function updateUrlSuggestion($row, index) {
        const $suggestion = $row.find('.url-suggestion');
        const suggestion = getStagingSuggestion($row.find('[data-field="url"]').val(), index);
        $row.removeData('url-suggestion');

        if (!suggestion) {
            $suggestion.prop('hidden', true).removeClass('duplicate').empty();
            return null;
        }

        $row.data('url-suggestion', suggestion);
        $suggestion
            .toggleClass('duplicate', suggestion.duplicate)
            .text(suggestion.duplicate
                ? `${suggestion.url} is already in Switcher`
                : `Press Enter to use ${suggestion.url}`)
            .prop('hidden', false);
        return suggestion;
    }

    function applyParsedUrl(index, $row, parsed, preferredName) {
        const site = sites[index];
        const key = normaliseUrlKey(parsed.url);
        const duplicate = sites.some((other, otherIndex) => otherIndex !== index && normaliseUrlKey(other.url) === key);
        if (duplicate) {
            validateAllRows();
            return false;
        }

        site.url = parsed.url;
        if (!normalise(site.name)) site.name = preferredName || parsed.name;
        if (!normalise(site.icon) && parsed.hostname.includes('.d3r.')) site.icon = '👁️';

        $row.find('[data-field="url"]').val(site.url);
        $row.find('[data-field="name"]').val(site.name);
        $row.find('[data-field="icon"]').val(site.icon);
        $row.find('.url-suggestion').prop('hidden', true).empty();
        $row.removeData('url-suggestion').addClass('changed');
        markDirty();
        validateAllRows();
        return true;
    }

    $sites.on('input', '.site-input', function () {
        const $input = $(this);
        const $row = $input.closest('.site-row');
        const index = Number($row.attr('data-index'));
        const field = $input.attr('data-field');
        sites[index][field] = $input.val();
        $row.addClass('changed');
        if (field === 'url') updateUrlSuggestion($row, index);
        markDirty();
        validateAllRows();
    });

    $sites.on('blur', '[data-field="url"]', function () {
        const $input = $(this);
        const $row = $input.closest('.site-row');
        const index = Number($row.attr('data-index'));
        const suggestion = getStagingSuggestion($input.val(), index);

        // A short staging name is completed only with Enter. Tab remains ordinary navigation.
        if (suggestion) {
            updateUrlSuggestion($row, index);
            validateAllRows();
            return;
        }

        const parsed = parseUrl($input.val());
        if (!parsed.valid) {
            validateAllRows();
            return;
        }

        if (!applyParsedUrl(index, $row, parsed)) return;

        if (projectSiteCount(selectedProject) === 1 && /^New project(?: \d+)?$/.test(selectedProject)) {
            const site = sites[index];
            const oldProject = selectedProject;
            const inferred = parsed.project.charAt(0).toUpperCase() + parsed.project.slice(1);
            const suggested = canonicalProjectName(inferred) || inferred;
            if (suggested && !uniqueProjects().some(project => project !== oldProject && projectKey(project) === projectKey(suggested))) {
                site.project = suggested;
                selectedProject = suggested;
                const position = projectNames.indexOf(oldProject);
                if (position !== -1) projectNames[position] = suggested;
                $projectName.val(suggested);
                renderProjects();
            }
        }
    });

    $sites.on('keydown', '.site-input', function (event) {
        if (event.key !== 'Enter') return;

        const $input = $(this);
        const $row = $input.closest('.site-row');
        const index = Number($row.attr('data-index'));
        const field = $input.attr('data-field');

        if (field === 'url') {
            const suggestion = $row.data('url-suggestion');
            if (suggestion) {
                event.preventDefault();
                if (suggestion.duplicate) return;
                const parsed = parseUrl(suggestion.url);
                if (parsed.valid && applyParsedUrl(index, $row, parsed, suggestion.name)) addSite();
                return;
            }

            const raw = normalise($input.val());
            const looksLikeUrl = /[.:/]/.test(raw) || raw.toLowerCase() === 'localhost';
            const parsed = looksLikeUrl ? parseUrl(raw) : { valid: false };
            if (parsed.valid) {
                event.preventDefault();
                if (applyParsedUrl(index, $row, parsed)) addSite();
            }
            return;
        }

        const site = sites[index];
        if (normalise(site.url) && normalise(site.name) && validateAllRows()) {
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
    let draggedSiteIndex = null;
    let droppedOnProject = false;

    function saveDisplayedSiteOrder() {
        const orderedIndices = $sites.children('.site-row').map(function () {
            return Number($(this).attr('data-index'));
        }).get();
        const selectedSites = orderedIndices
            .map(index => sites[index])
            .filter(site => site && sameProject(site.project, selectedProject));
        const expectedCount = sites.filter(site => site && sameProject(site.project, selectedProject)).length;
        if (selectedSites.length !== expectedCount) {
            renderSites();
            return;
        }
        let selectedCursor = 0;
        sites = sites.map(site => site && sameProject(site.project, selectedProject) ? selectedSites[selectedCursor++] : site);
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
        draggedSiteIndex = Number($(this).attr('data-index'));
        droppedOnProject = false;
        $(this).addClass('dragging');
        $('.project-panel').addClass('site-drag-active');
        const transfer = event.originalEvent.dataTransfer;
        transfer.effectAllowed = 'move';
        // Firefox requires data to be set before it will start a drag operation.
        transfer.setData('text/plain', $(this).attr('data-index'));
    });

    $projectList.on('dragover', '.project-item', function (event) {
        if (!draggedRow) return;
        event.preventDefault();
        event.stopPropagation();
        event.originalEvent.dataTransfer.dropEffect = 'move';
        $('.project-item').removeClass('drop-target');
        if (!sameProject($(this).attr('data-project'), selectedProject)) {
            $(this).addClass('drop-target');
        }
    });

    $projectList.on('dragleave', '.project-item', function () {
        $(this).removeClass('drop-target');
    });

    $projectList.on('drop', '.project-item', function (event) {
        if (!draggedRow || draggedSiteIndex === null) return;
        event.preventDefault();
        event.stopPropagation();
        const targetProject = canonicalProjectName($(this).attr('data-project'));
        if (!targetProject || sameProject(targetProject, selectedProject)) return;

        const movedSite = sites[draggedSiteIndex];
        if (!movedSite) return;
        movedSite.project = targetProject;
        droppedOnProject = true;
        $('.project-item').removeClass('drop-target');
        $('.project-panel').removeClass('site-drag-active');
        $(draggedRow).addClass('moved-away');
        markDirty((movedSite.name || 'Site') + ' moved to ' + targetProject);
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
        $('.project-item').removeClass('drop-target');
        $('.project-panel').removeClass('site-drag-active');
        draggedRow = null;
        draggedSiteIndex = null;
        if (moved && droppedOnProject) {
            renderProjects();
            renderSites();
        } else if (moved) {
            saveDisplayedSiteOrder();
        }
        droppedOnProject = false;
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
        const selected = sites.filter(site => site && sameProject(site.project, selectedProject));
        selected.sort((a, b) => {
            const groupDifference = siteSortGroup(a) - siteSortGroup(b);
            if (groupDifference) return groupDifference;
            const nameDifference = normalise(a.name).localeCompare(normalise(b.name), undefined, { sensitivity: 'base' });
            if (nameDifference) return nameDifference;
            return normalise(a.url).localeCompare(normalise(b.url), undefined, { sensitivity: 'base' });
        });
        let cursor = 0;
        sites = sites.map(site => sameProject(site.project, selectedProject) ? selected[cursor++] : site);
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

        sites = sites.filter(site => !sameProject(site.project, selectedProject));
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

        // Cleaning the array can change site indexes. Rebuild the visible rows
        // before validating so each row still points at the correct site.
        renderProjects();
        renderSites();

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
                const project = canonicalProjectName(cleanProjectName(values[2]) || parsed.project);
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

    function filenameSlug(value) {
        return normalise(value)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'project';
    }

    function exportSites(rows, filenamePrefix) {
        const exportRows = rows.filter(site => site && normalise(site.url));
        if (!exportRows.length) {
            $saveStatus.text('There are no sites to export').addClass('error');
            return;
        }
        const csv = exportRows.map(site => [site.name, site.url, site.project, site.icon].map(escapeCsv).join(', ')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const date = new Date();
        const stamp = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
        const anchor = document.createElement('a');
        const objectUrl = URL.createObjectURL(blob);
        anchor.href = objectUrl;
        anchor.download = `${filenamePrefix}-${stamp}.csv`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    }

    $('#export').on('click', function () {
        removeEmptySites();
        exportSites(sites, 'switcher-sites');
    });

    $('#export-project').on('click', function () {
        if (!selectedProject) return;
        removeEmptySites();
        const projectSites = sites.filter(site => site && sameProject(site.project, selectedProject));
        exportSites(projectSites, `switcher-${filenameSlug(selectedProject)}`);
    });


    const bulkDialog = document.getElementById('bulk-dialog');
    const $bulkTemplate = $('#bulk-template');
    const $bulkSites = $('#bulk-sites');
    const $bulkPreview = $('#bulk-preview');
    const $bulkSummary = $('#bulk-summary');
    const $bulkError = $('#bulk-error');
    const $bulkConfirm = $('#bulk-confirm');
    let bulkCandidates = [];

    function inferStagingTemplate(project) {
        const projectSites = sites.filter(site => site && sameProject(site.project, project));
        for (const site of projectSites) {
            const parsed = parseUrl(site.url);
            if (!parsed.valid || !parsed.hostname.includes('.d3r.')) continue;
            const labels = parsed.hostname.split('.');
            const hostParts = labels[0].split('-').filter(Boolean);
            if (hostParts.length < 2) continue;
            hostParts[0] = '{slug}';
            labels[0] = hostParts.join('-');
            return `https://${labels.join('.')}`;
        }
        return '';
    }

    function splitBulkEntries(value) {
        return String(value || '')
            .split(/[\n,]+/)
            .map(item => item.trim())
            .filter(Boolean);
    }

    function slugify(value) {
        return normalise(value)
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .replace(/-{2,}/g, '-');
    }

    function buildBulkCandidates() {
        const entries = splitBulkEntries($bulkSites.val());
        const template = normalise($bulkTemplate.val());
        const existingUrls = new Set(sites.map(site => normaliseUrlKey(site.url)).filter(Boolean));
        const incomingUrls = new Set();
        const candidates = [];
        let templateError = '';

        entries.forEach(entry => {
            const isFullUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(entry);
            let name = '';
            let parsed;

            if (isFullUrl) {
                parsed = parseUrl(entry);
                name = parsed.valid ? parsed.name : entry;
            } else {
                const slug = slugify(entry);
                name = normalise(entry);
                if (!template) {
                    templateError = 'Enter a template for short site names.';
                    parsed = { valid: false, message: templateError };
                } else if (!template.includes('{slug}')) {
                    templateError = 'The template must contain {slug}.';
                    parsed = { valid: false, message: templateError };
                } else if (!slug) {
                    parsed = { valid: false, message: 'This site name cannot be turned into a URL slug.' };
                } else {
                    parsed = parseUrl(template.replaceAll('{slug}', slug));
                }
            }

            const key = parsed.valid ? normaliseUrlKey(parsed.url) : '';
            const duplicate = Boolean(key && (existingUrls.has(key) || incomingUrls.has(key)));
            if (key) incomingUrls.add(key);
            candidates.push({
                name: name,
                url: parsed.valid ? parsed.url : '',
                valid: parsed.valid,
                duplicate: duplicate,
                message: parsed.valid ? (duplicate ? 'Duplicate' : '') : parsed.message
            });
        });

        bulkCandidates = candidates;
        $bulkPreview.empty();
        candidates.forEach(candidate => {
            const $item = $('<li>', { class: candidate.valid && !candidate.duplicate ? '' : 'skipped' });
            $('<span>', { class: 'preview-name', text: candidate.name || 'Invalid entry' }).appendTo($item);
            $('<span>', {
                class: 'preview-url',
                text: candidate.valid ? candidate.url + (candidate.duplicate ? ' · duplicate' : '') : candidate.message
            }).appendTo($item);
            $bulkPreview.append($item);
        });

        const addable = candidates.filter(candidate => candidate.valid && !candidate.duplicate).length;
        const skipped = candidates.length - addable;
        $bulkSummary.text(entries.length
            ? `${addable} to add${skipped ? `, ${skipped} skipped` : ''}`
            : 'Nothing to add yet');
        $bulkError.text(templateError);
        $bulkConfirm.prop('disabled', addable === 0 || Boolean(templateError));
        $bulkConfirm.text(addable === 1 ? 'Add 1 site' : `Add ${addable} sites`);
    }

    $('#bulk-add-site').on('click', function () {
        if (!selectedProject) return;
        $bulkTemplate.val(inferStagingTemplate(selectedProject));
        $bulkSites.val('');
        $bulkError.text('');
        buildBulkCandidates();
        bulkDialog.showModal();
        setTimeout(() => $bulkSites.trigger('focus'), 0);
    });

    $bulkTemplate.add($bulkSites).on('input', buildBulkCandidates);

    $bulkConfirm.on('click', function () {
        const addable = bulkCandidates.filter(candidate => candidate.valid && !candidate.duplicate);
        if (!addable.length || !selectedProject) return;

        addable.forEach(candidate => {
            sites.push({
                name: candidate.name,
                url: candidate.url,
                project: selectedProject,
                icon: candidate.url.includes('.d3r.') ? '👁️' : ''
            });
        });

        bulkDialog.close();
        renderProjects();
        renderSites();
        markDirty(`${addable.length} site${addable.length === 1 ? '' : 's'} added. Save changes to finish.`);
    });

    bulkDialog.addEventListener('click', function (event) {
        if (event.target === bulkDialog) bulkDialog.close();
    });

    window.addEventListener('beforeunload', function (event) {
        if (!dirty) return;
        event.preventDefault();
        event.returnValue = '';
    });
});
