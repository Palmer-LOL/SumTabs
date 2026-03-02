document.getElementById("openSettings").addEventListener("click", async () => {
    await chrome.runtime.openOptionsPage();
    window.close();
});
