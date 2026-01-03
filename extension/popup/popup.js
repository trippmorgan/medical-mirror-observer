// popup.js - Observer popup UI

document.addEventListener('DOMContentLoaded', () => {
  loadStatus();
  loadRecentEvents();

  // Clear button
  document.getElementById('btn-clear').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CLEAR_EVENTS' }, (response) => {
      if (response?.cleared) {
        loadStatus();
        loadRecentEvents();
      }
    });
  });

  // Auto-refresh every 2 seconds
  setInterval(() => {
    loadStatus();
    loadRecentEvents();
  }, 2000);
});

function loadStatus() {
  chrome.runtime.sendMessage({ type: 'GET_OBSERVER_STATUS' }, (status) => {
    if (!status) return;

    document.getElementById('version').textContent = `v${status.version}`;
    document.getElementById('event-count').textContent = status.eventCount || 0;
    document.getElementById('error-count').textContent = status.errorCount || 0;

    const sourcesList = document.getElementById('sources-list');
    if (status.sources && status.sources.length > 0) {
      sourcesList.innerHTML = status.sources
        .map(s => `<span class="source-tag">${s}</span>`)
        .join('');
    } else {
      sourcesList.innerHTML = '<span class="no-sources">No sources detected yet</span>';
    }
  });
}

function loadRecentEvents() {
  chrome.runtime.sendMessage({ type: 'GET_RECENT_EVENTS', limit: 10 }, (response) => {
    const eventList = document.getElementById('event-list');

    if (!response?.events || response.events.length === 0) {
      eventList.innerHTML = '<div class="no-sources">No events recorded</div>';
      return;
    }

    eventList.innerHTML = response.events.map(e => {
      const event = e.event || {};
      const isError = event.success === false;
      const time = new Date(event.timestamp || e.storedAt).toLocaleTimeString();

      return `
        <div class="event-item ${isError ? 'error' : ''}">
          <span class="event-stage">${event.stage || 'unknown'}</span>
          <span class="event-action">→ ${event.action || 'event'}</span>
          <span class="event-time">${time}</span>
        </div>
      `;
    }).join('');
  });
}
