(function () {
  function buildLayout(input) {
    const mode = input.appMode?.mode || "normal";
    const ambientActive = Boolean(input.ambient?.visible);
    const mediaActive = Boolean(input.mediaActive);
    const requestedCameraLayout = input.cameraLayout || "five";
    const primaryCameraId = input.primaryCameraId || input.focusedCameraId;
    const cameras = orderCameras(input.cameras || [], primaryCameraId);

    if (mode === "winddown") {
      return {
        mode,
        stageClass: "stage mode-winddown",
        cameraClass: "camera-wall camera-strip",
        cameras,
        showStream: false,
        showWinddown: true,
        showInfoRail: true
      };
    }

    if (mode === "yankees") {
      return {
        mode,
        stageClass: "stage mode-yankees",
        cameraClass: "camera-wall camera-stack",
        cameras,
        showStream: true,
        showWinddown: false,
        showInfoRail: true
      };
    }

    const cameraClass = requestedCameraLayout === "focus"
      ? "camera-wall camera-focus"
      : requestedCameraLayout === "split"
        ? "camera-wall camera-split"
        : requestedCameraLayout === "grid4"
          ? "camera-wall camera-grid4"
          : "camera-wall camera-mosaic";

    return {
      mode: "normal",
      stageClass: ambientActive ? "stage mode-normal has-ambient" : mediaActive ? "stage mode-normal has-media" : "stage mode-normal",
      cameraClass,
      cameras: selectCameras(cameras, requestedCameraLayout),
      showStream: false,
      showWinddown: false,
      showInfoRail: true,
      showAmbient: ambientActive
    };
  }

  function orderCameras(cameras, primaryCameraId) {
    const sorted = [...cameras].sort((a, b) => (a.priority || 99) - (b.priority || 99));
    const primary = sorted.find((camera) => camera.id === primaryCameraId);
    if (!primary) return sorted;
    return [primary, ...sorted.filter((camera) => camera.id !== primaryCameraId)];
  }

  function selectCameras(cameras, layout) {
    if (layout === "focus") return cameras.slice(0, 1);
    if (layout === "split") return cameras.slice(0, 2);
    if (layout === "grid4") return cameras.slice(0, 4);
    return cameras.slice(0, 5);
  }

  window.closetCastLayout = { buildLayout };
})();
