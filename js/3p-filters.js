/*******************************************************************************

    µBlock - a Chromium browser extension to block requests.
    Copyright (C) 2014 Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

/* global chrome, messaging, uDom */

/******************************************************************************/

(function() {

/******************************************************************************/

var userListName = chrome.i18n.getMessage('1pPageName');
var listDetails = {};
var externalLists = '';
var cacheWasPurged = false;

/******************************************************************************/

messaging.start('3p-filters.js');

var onMessage = function(msg) {
    switch ( msg.what ) {
        case 'loadUbiquitousBlacklistCompleted':
            renderBlacklists();
            selectedBlacklistsChanged();
            break;

        default:
            break;
    }
};

messaging.listen(onMessage);

/******************************************************************************/

var getµb = function() {
    return chrome.extension.getBackgroundPage().µBlock;
};

/******************************************************************************/

var renderNumber = function(value) {
    return value.toLocaleString();
};

/******************************************************************************/

// TODO: get rid of background page dependencies

var renderBlacklists = function() {
    // empty list first
    var µb = getµb();

    uDom('#listsOfBlockedHostsPrompt').text(
        chrome.i18n.getMessage('3pListsOfBlockedHostsPrompt')
            .replace('{{netFilterCount}}', renderNumber(µb.abpFilters.getFilterCount()))
            .replace('{{cosmeticFilterCount}}', renderNumber(µb.abpHideFilters.getFilterCount()))
    );

    // Assemble a pretty blacklist name if possible
    var htmlFromListName = function(blacklistTitle, blacklistHref) {
        if ( blacklistHref === µb.userFiltersPath ) {
            return userListName;
        }
        if ( !blacklistTitle ) {
            return blacklistHref;
        }
        if ( blacklistHref.indexOf('assets/thirdparties/') !== 0 ) {
            return blacklistTitle;
        }
        var matches = blacklistHref.match(/^assets\/thirdparties\/([^\/]+)/);
        if ( matches === null || matches.length !== 2 ) {
            return blacklistTitle;
        }
        var hostname = matches[1];
        var domain = µb.URI.domainFromHostname(hostname);
        if ( domain === '' ) {
            return blacklistTitle;
        }
        var html = [
            blacklistTitle,
            ' <i>(<a href="http://',
            hostname,
            '" target="_blank">',
            domain,
            '</a>)</i>'
        ];
        return html.join('');
    };

    var listStatsTemplate = chrome.i18n.getMessage('3pListsOfBlockedHostsPerListStats');
    var purgeButtontext = chrome.i18n.getMessage('3pExternalListPurge');

    var htmlFromBranch = function(groupKey, listKeys, lists) {
        var html = [
            '<li>',
            chrome.i18n.getMessage('3pGroup' + groupKey.charAt(0).toUpperCase() + groupKey.slice(1)),
            '<ul>'
        ];
        if ( !listKeys ) {
            return html.join('');
        }
        listKeys.sort(function(a, b) {
            return lists[a].title.localeCompare(lists[b].title);
        });
        var listEntryTemplate = [
            '<li class="listDetails">',
            '<input type="checkbox" {{checked}}>',
            '&thinsp;',
            '<a href="{{URL}}" type="text/plain">',
            '{{name}}',
            '</a>',
            ': ',
            '<span class="dim">',
            listStatsTemplate,
            '</span>'
        ].join('');
        var listKey, list, listEntry;
        for ( var i = 0; i < listKeys.length; i++ ) {
            listKey = listKeys[i];
            list = lists[listKey];
            listEntry = listEntryTemplate
                .replace('{{checked}}', list.off ? '' : 'checked')
                .replace('{{URL}}', encodeURI(listKey))
                .replace('{{name}}', htmlFromListName(list.title, listKey))
                .replace('{{used}}', !list.off && !isNaN(+list.entryUsedCount) ? renderNumber(list.entryUsedCount) : '0')
                .replace('{{total}}', !isNaN(+list.entryCount) ? renderNumber(list.entryCount) : '?');
            html.push(listEntry);
            // https://github.com/gorhill/uBlock/issues/104
            if ( /^https?:\/\/.+/.test(listKey) && listDetails.cache[listKey] ) {
                html.push(
                    '&ensp;',
                    '<button type="button" class="purge">',
                    purgeButtontext,
                    '</button>'
                );
            }
        }
        html.push('</ul>');
        return html.join('');
    };

    var groupsFromLists = function(lists) {
        var groups = {};
        var listKeys = Object.keys(lists);
        var i = listKeys.length;
        var listKey, list, groupKey;
        while ( i-- ) {
            listKey = listKeys[i];
            list = lists[listKey];
            groupKey = list.group || 'nogroup';
            if ( groups[groupKey] === undefined ) {
                groups[groupKey] = [];
            }
            groups[groupKey].push(listKey);
        }
        return groups;
    };

    var onListsReceived = function(details) {
        listDetails = details;

        var lists = details.available;
        var html = [];
        var groups = groupsFromLists(lists);
        var groupKey, i;
        var groupKeys = [
            'default',
            'ads',
            'privacy',
            'malware',
            'social',
            'multipurpose',
            'regions',
            'custom'
        ];
        for ( i = 0; i < groupKeys.length; i++ ) {
            groupKey = groupKeys[i];
            html.push(htmlFromBranch(groupKey, groups[groupKey], lists));
            delete groups[groupKey];
        }
        // For all groups not covered above (if any left)
        groupKeys = Object.keys(groups);
        for ( i = 0; i < groupKeys.length; i++ ) {
            groupKey = groupKeys[i];
            html.push(htmlFromBranch(groupKey, groups[groupKey], lists));
            delete groups[groupKey];
        }

        uDom('#lists .listDetails').remove();
        uDom('#lists').html(html.join(''));
        uDom('#parseAllABPHideFilters').prop('checked', listDetails.cosmetic === true);
        uDom('#ubiquitousParseAllABPHideFiltersPrompt2').text(
            chrome.i18n.getMessage("listsParseAllABPHideFiltersPrompt2")
                .replace('{{abpHideFilterCount}}', renderNumber(µb.abpHideFilters.getFilterCount()))
        );
        uDom('a').attr('target', '_blank');
        selectedBlacklistsChanged();
    };

    messaging.ask({ what: 'getLists' }, onListsReceived);
};

/******************************************************************************/

// Check whether lists need reloading.

var needToReload = function() {
    if ( listDetails.cosmetic !== getµb().userSettings.parseAllABPHideFilters ) {
        return true;
    }
    if ( cacheWasPurged ) {
        return true;
    }
    var availableLists = listDetails.available;
    var currentLists = listDetails.current;
    var location, availableOff, currentOff;
    // This check existing entries
    for ( location in availableLists ) {
        if ( availableLists.hasOwnProperty(location) === false ) {
            continue;
        }
        availableOff = availableLists[location].off === true;
        currentOff = currentLists[location] === undefined || currentLists[location].off === true;
        if ( availableOff !== currentOff ) {
            return true;
        }
    }
    // This check removed entries
    for ( location in currentLists ) {
        if ( currentLists.hasOwnProperty(location) === false ) {
            continue;
        }
        currentOff = currentLists[location].off === true;
        availableOff = availableLists[location] === undefined || availableLists[location].off === true;
        if ( availableOff !== currentOff ) {
            return true;
        }
    }
    return false;
};

/******************************************************************************/

// This is to give a visual hint that the selection of blacklists has changed.

var selectedBlacklistsChanged = function() {
    uDom('#blacklistsApply').prop('disabled', !needToReload());
};

/******************************************************************************/

var onListCheckboxChanged = function() {
    var href = uDom(this).parent().find('a').first().attr('href');
    if ( typeof href !== 'string' ) {
        return;
    }
    if ( listDetails.available[href] === undefined ) {
        return;
    }
    listDetails.available[href].off = !this.checked;
    selectedBlacklistsChanged();
};

/******************************************************************************/

var onListLinkClicked = function(ev) {
    messaging.tell({
        what: 'gotoExtensionURL',
        url: 'asset-viewer.html?url=' + uDom(this).attr('href')
    });
    ev.preventDefault();
};

/******************************************************************************/

var onPurgeClicked = function(ev) {
    var button = uDom(this);
    var href = button.parent().find('a').first().attr('href');
    if ( !href ) {
        return;
    }
    messaging.tell({ what: 'purgeCache', path: href });
    button.remove();
    cacheWasPurged = true;
    selectedBlacklistsChanged();
};

/******************************************************************************/

var blacklistsApplyHandler = function() {
    if ( !needToReload() ) {
        return;
    }
    // Reload blacklists
    messaging.tell({
        what: 'userSettings',
        name: 'parseAllABPHideFilters',
        value: listDetails.cosmetic
    });
    // Reload blacklists
    var switches = [];
    var lis = uDom('#lists .listDetails');
    var i = lis.length();
    var path;
    while ( i-- ) {
        path = lis
            .subset(i)
            .find('a')
            .attr('href');
        switches.push({
            location: path,
            off: lis.subset(i).find('input').prop('checked') === false
        });
    }
    messaging.tell({
        what: 'reloadAllFilters',
        switches: switches
    });
    cacheWasPurged = false;
    uDom('#blacklistsApply').prop('disabled', true);
};

/******************************************************************************/

var abpHideFiltersCheckboxChanged = function() {
    listDetails.cosmetic = this.checked;
    selectedBlacklistsChanged();
};

/******************************************************************************/

var renderExternalLists = function() {
    var onReceived = function(details) {
        uDom('#externalLists').val(details);
        externalLists = details;
    };
    messaging.ask({ what: 'userSettings', name: 'externalLists' }, onReceived);
};

/******************************************************************************/

var externalListsChangeHandler = function() {
    uDom('#externalListsApply').prop(
        'disabled',
        this.value.trim() === externalLists
    );
};

/******************************************************************************/

var externalListsApplyHandler = function() {
    externalLists = uDom('#externalLists').val();
    messaging.tell({
        what: 'userSettings',
        name: 'externalLists',
        value: externalLists
    });
    renderBlacklists();
    uDom('#externalListsApply').prop('disabled', true);
};

/******************************************************************************/

uDom.onLoad(function() {
    // Handle user interaction
    uDom('#parseAllABPHideFilters').on('change', abpHideFiltersCheckboxChanged);
    uDom('#blacklistsApply').on('click', blacklistsApplyHandler);
    uDom('#lists').on('change', '.listDetails > input', onListCheckboxChanged);
    uDom('#lists').on('click', '.listDetails > a:nth-of-type(1)', onListLinkClicked);
    uDom('#lists').on('click', 'button.purge', onPurgeClicked);
    uDom('#externalLists').on('input', externalListsChangeHandler);
    uDom('#externalListsApply').on('click', externalListsApplyHandler);

    renderBlacklists();
    renderExternalLists();
});

/******************************************************************************/

})();

