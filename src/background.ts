// Open the side panel when the user clicks the FlowPilot extension icon
chrome.action.onClicked.addListener((tab) => {
    if (tab.id) {
        chrome.sidePanel.open({ windowId: tab.windowId });
    }
});