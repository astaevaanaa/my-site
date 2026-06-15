// Moon Designer - In-Page Direct Layout Editor & Device Simulator Overlay
(function() {
  if (window.__moonEditorActive) return;
  window.__moonEditorActive = true;

  // Branch behavior: Check if running inside the device simulator iframe
  const urlParams = new URLSearchParams(window.location.search);
  const isIframeView = urlParams.has('iframe_view');

  // Disable scroll restoration to prevent automatic layout jumps on reloads
  if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
  }

  console.log(`Moon Designer Editor loading (Mode: ${isIframeView ? 'Iframe Overlay' : 'Parent Workspace'})`);

  // State Management
  let currentConfig = { desktop: {}, tablet: {}, mobile: {} };
  const undoStack = [];
  const redoStack = [];
  const MAX_HISTORY = 50;

  let activeBreakpoint = 'desktop'; // desktop, tablet, mobile
  let selectedElement = null;
  let hoveredElement = null;
  let selectedSelector = null;
  let selectedTagName = 'None';
  let selectedClassList = [];
  let currentScope = 'element'; // element, class
  let changesMade = false;

  // Visual Drag / Resize state
  let isDragging = false;
  let isResizing = false;
  let dragStart = { x: 0, y: 0 };
  let elemStart = { width: 0, height: 0, left: 0, top: 0, marginTop: 0, marginLeft: 0 };
  let activeHandle = null;
  let stateBeforeAction = null;
  let dragStyles = {};
  let isTouchDevice = false;

  // Parent UI variables
  let sidebar, toolbar, modal, toast, expandBubble, expandTBBubble;
  let isSimulatorActive = false;
  let simulatorContainer = null;
  let simulatorIframe = null;
  let inputs = {}, sliders = {};
  let stateBeforeEdit = null;

  // Shared Overlay variables
  let hoverBox, selectionBox, selectionLabel, selectionDims;
  let marginOverlays = {}, paddingOverlays = {};

  window.addEventListener('touchstart', () => {
    isTouchDevice = true;
  }, { passive: true });

  // 1. Initialize Style Tag in Head for real-time visual overrides
  const liveStyleTag = document.createElement('style');
  liveStyleTag.id = 'editor-live-styles';
  document.head.appendChild(liveStyleTag);

  // 2. Load Configuration from Disk
  if (!isIframeView) {
    fetch('editor-config.json')
      .then(res => res.json())
      .then(data => {
        currentConfig = {
          desktop: data.desktop || {},
          tablet: data.tablet || {},
          mobile: data.mobile || {}
        };
        updateStyleTagOverrides();
        console.log('Loaded editor configuration successfully.');
      })
      .catch(err => {
        console.warn('Could not read config, starting fresh:', err);
      });
  }

  // ==========================================
  // BRANCH A: IFRAME OVERLAY MODE (PREVIEW FRAME)
  // ==========================================
  if (isIframeView) {
    // Iframe only renders the interactive bounding box overlays and listens to events
    setupVisualOverlayElements();
    setupSelectionListeners();
    setupIframeMessageListener();
    window.scrollTo(0, 0);
  } 
  // ==========================================
  // BRANCH B: PARENT WORKSPACE MODE
  // ==========================================
  else {
    setupEditorPanels();
    setupVisualOverlayElements(); // Parent overlay active for direct desktop editing
    setupSelectionListeners();
    setupParentMessageListener();
    setupBreakpointDetection();
  }

  // ==========================================
  // SHARED FUNCTIONS: OVERLAY ELEMENTS CREATION
  // ==========================================

  function setupVisualOverlayElements() {
    const overlayContainer = document.createElement('div');
    overlayContainer.id = 'editor-overlay-container';
    overlayContainer.className = 'editor-reset';
    document.body.appendChild(overlayContainer);

    hoverBox = document.createElement('div');
    hoverBox.className = 'editor-hover-box';
    hoverBox.style.display = 'none';
    overlayContainer.appendChild(hoverBox);

    selectionBox = document.createElement('div');
    selectionBox.className = 'editor-selection-box';
    selectionBox.style.display = 'none';
    
    selectionLabel = document.createElement('div');
    selectionLabel.className = 'editor-selection-label';
    selectionBox.appendChild(selectionLabel);

    selectionDims = document.createElement('div');
    selectionDims.className = 'editor-selection-dims';
    selectionBox.appendChild(selectionDims);

    const handleClasses = ['tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r'];
    handleClasses.forEach(hc => {
      const handle = document.createElement('div');
      handle.className = `editor-handle ${hc}`;
      handle.dataset.handle = hc;
      selectionBox.appendChild(handle);
    });
    overlayContainer.appendChild(selectionBox);

    marginOverlays = {
      top: createSpacingOverlay('margin', overlayContainer),
      right: createSpacingOverlay('margin', overlayContainer),
      bottom: createSpacingOverlay('margin', overlayContainer),
      left: createSpacingOverlay('margin', overlayContainer)
    };
    
    paddingOverlays = {
      top: createSpacingOverlay('padding', overlayContainer),
      right: createSpacingOverlay('padding', overlayContainer),
      bottom: createSpacingOverlay('padding', overlayContainer),
      left: createSpacingOverlay('padding', overlayContainer)
    };
  }

  function createSpacingOverlay(type, container) {
    const el = document.createElement('div');
    el.className = `editor-spacing-overlay editor-${type}-overlay`;
    el.style.display = 'none';
    container.appendChild(el);
    return el;
  }

  // ==========================================
  // SHARED FUNCTIONS: ELEMENT SELECTION & DRAG
  // ==========================================
  function setupSelectionListeners() {
    // Hover outlining (mouseover)
    document.addEventListener('mouseover', (e) => {
      if (isDragging || isResizing || isTouchDevice || isSimulatorActive) return;
      
      if (e.target.closest('#editor-sidebar-panel') || 
          e.target.closest('#editor-toolbar-header') || 
          e.target.closest('#editor-overlay-container') ||
          e.target.closest('#editor-export-modal') ||
          e.target.closest('#editor-toast') ||
          e.target.closest('#editor-expand-panel-bubble') ||
          e.target.closest('#editor-simulator-container')) return;
          
      if (e.target === document.body || e.target === document.documentElement) {
        hoverBox.style.display = 'none';
        return;
      }

      hoveredElement = e.target;
      updateHoverBox(hoveredElement);
    }, true);

    document.addEventListener('mouseout', (e) => {
      if (e.target === hoveredElement) {
        hoverBox.style.display = 'none';
        hoveredElement = null;
      }
    }, true);

    // Selection on click
    document.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey) return; // Ctrl+Click allows native interactions
      if (isSimulatorActive && !isIframeView) return; // Parent ignores clicks if simulator active

      if (e.target.closest('#editor-sidebar-panel') || 
          e.target.closest('#editor-toolbar-header') || 
          e.target.closest('#editor-overlay-container') ||
          e.target.closest('#editor-export-modal') ||
          e.target.closest('#editor-toast') ||
          e.target.closest('#editor-expand-panel-bubble') ||
          e.target.closest('#editor-simulator-container')) return;

      e.preventDefault();
      e.stopPropagation();

      if (e.target === document.body || e.target === document.documentElement) {
        deselectElement();
        return;
      }

      selectElement(e.target);
    }, true);

    // Visual drag/resize events
    selectionBox.addEventListener('mousedown', (e) => {
      if (!selectedElement) return;

      const handle = e.target.closest('.editor-handle');
      if (handle) {
        isResizing = true;
        activeHandle = handle.dataset.handle;
      } else {
        isDragging = true;
      }

      dragStart.x = e.clientX;
      dragStart.y = e.clientY;

      const el = selectedElement;
      const comp = window.getComputedStyle(el);

      elemStart.width = el.offsetWidth;
      elemStart.height = el.offsetHeight;
      elemStart.left = parseFloat(comp.left) || 0;
      elemStart.top = parseFloat(comp.top) || 0;
      elemStart.marginTop = parseFloat(comp.marginTop) || 0;
      elemStart.marginLeft = parseFloat(comp.marginLeft) || 0;

      // Start state recording
      if (!isIframeView) {
        stateBeforeAction = JSON.stringify(currentConfig);
      } else {
        window.parent.postMessage({ type: 'iframe_drag_start' }, '*');
      }
      dragStyles = {};

      e.preventDefault();
      e.stopPropagation();

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    // Touch support for visual drag/resize
    selectionBox.addEventListener('touchstart', (e) => {
      if (!selectedElement || e.touches.length === 0) return;
      isTouchDevice = true;

      const touch = e.touches[0];
      const target = document.elementFromPoint(touch.clientX, touch.clientY);
      const handle = target ? target.closest('.editor-handle') : null;
      
      if (handle) {
        isResizing = true;
        activeHandle = handle.dataset.handle;
      } else {
        isDragging = true;
      }

      dragStart.x = touch.clientX;
      dragStart.y = touch.clientY;

      const el = selectedElement;
      const comp = window.getComputedStyle(el);

      elemStart.width = el.offsetWidth;
      elemStart.height = el.offsetHeight;
      elemStart.left = parseFloat(comp.left) || 0;
      elemStart.top = parseFloat(comp.top) || 0;
      elemStart.marginTop = parseFloat(comp.marginTop) || 0;
      elemStart.marginLeft = parseFloat(comp.marginLeft) || 0;

      // Start state recording
      if (!isIframeView) {
        stateBeforeAction = JSON.stringify(currentConfig);
      } else {
        window.parent.postMessage({ type: 'iframe_drag_start' }, '*');
      }
      dragStyles = {};

      e.preventDefault();
      e.stopPropagation();

      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', onTouchEnd);
    }, { passive: false });
  }

  function selectElement(el) {
    selectedElement = el;
    hoverBox.style.display = 'none';

    selectedSelector = calculateUniqueSelector(el);
    selectedTagName = el.tagName.toLowerCase();
    selectedClassList = Array.from(el.classList).filter(c => !c.startsWith('editor-'));

    const styles = getSelectionStylesMap(el);

    if (!isIframeView) {
      document.getElementById('selected-tag').textContent = selectedTagName;
      document.getElementById('selected-selector').textContent = selectedSelector;

      // Enable reset button and inputs
      document.getElementById('tb-reset').disabled = false;
      document.querySelectorAll('#editor-sidebar-panel input, #editor-sidebar-panel select').forEach(input => {
        input.removeAttribute('disabled');
      });

      const scopeClassBtn = document.getElementById('scope-class');
      if (selectedClassList.length > 0) {
        scopeClassBtn.disabled = false;
        scopeClassBtn.textContent = `All with .${selectedClassList[0]}`;
      } else {
        scopeClassBtn.disabled = true;
        scopeClassBtn.textContent = 'All with Class';
        currentScope = 'element';
        document.getElementById('scope-element').classList.add('active');
        scopeClassBtn.classList.remove('active');
      }

      // Toggle Flex Controls display
      const isFlex = styles.display === 'flex' || styles.display === 'inline-flex';
      document.querySelectorAll('.layout-flex-only').forEach(div => {
        div.style.display = isFlex ? 'block' : 'none';
      });

      updateSelectionBox();
      refreshSidebarInputs(styles);
    } else {
      // Inside Iframe: notify parent of selection
      updateSelectionBox();
      window.parent.postMessage({
        type: 'iframe_element_selected',
        selector: selectedSelector,
        tagName: selectedTagName,
        classList: selectedClassList,
        styles: styles
      }, '*');
    }
  }

  function deselectElement() {
    selectedElement = null;
    selectedSelector = null;
    selectedTagName = 'None';
    selectedClassList = [];

    if (!isIframeView) {
      document.getElementById('selected-tag').textContent = 'None selected';
      document.getElementById('selected-selector').textContent = 'Click on any page element to select it and start editing.';

      document.getElementById('tb-reset').disabled = true;
      selectionBox.style.display = 'none';
      hideSpacingOverlays();

      document.querySelectorAll('#editor-sidebar-panel input, #editor-sidebar-panel select').forEach(input => {
        input.setAttribute('disabled', 'true');
      });
    } else {
      selectionBox.style.display = 'none';
      hideSpacingOverlays();
      window.parent.postMessage({ type: 'iframe_element_deselected' }, '*');
    }
  }

  function calculateUniqueSelector(el) {
    if (el.id) return `#${el.id}`;
    if (el.tagName === 'BODY') return 'body';
    if (el.tagName === 'HTML') return 'html';

    const path = [];
    let current = el;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let selector = current.tagName.toLowerCase();
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.split(/\s+/).filter(c => c && !c.startsWith('editor-'));
        if (classes.length > 0) {
          selector += `.${classes[0]}`;
        }
      }
      if (current.parentNode) {
        const siblings = Array.from(current.parentNode.children).filter(s => s.tagName === current.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-of-type(${index})`;
        }
      }
      path.unshift(selector);
      if (current.parentNode && current.parentNode.id) {
        path.unshift(`#${current.parentNode.id}`);
        break;
      }
      current = current.parentNode;
    }
    return path.join(' > ');
  }

  function getActiveScopeSelector() {
    if (currentScope === 'class' && selectedClassList && selectedClassList.length > 0) {
      return '.' + selectedClassList[0];
    }
    return selectedSelector;
  }

  function updateHoverBox(el) {
    const rect = el.getBoundingClientRect();
    hoverBox.style.width = rect.width + 'px';
    hoverBox.style.height = rect.height + 'px';
    hoverBox.style.left = (rect.left + window.scrollX) + 'px';
    hoverBox.style.top = (rect.top + window.scrollY) + 'px';
    hoverBox.style.display = 'block';
  }

  function updateSelectionBox() {
    if (!selectedElement) return;

    const el = selectedElement;
    const rect = el.getBoundingClientRect();
    const pageX = rect.left + window.scrollX;
    const pageY = rect.top + window.scrollY;

    selectionBox.style.width = rect.width + 'px';
    selectionBox.style.height = rect.height + 'px';
    selectionBox.style.left = pageX + 'px';
    selectionBox.style.top = pageY + 'px';
    selectionBox.style.display = 'block';

    selectionLabel.textContent = `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}`;
    selectionDims.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)} px`;

    // Draw Margins/Paddings overlays
    const comp = window.getComputedStyle(el);
    const mt = parseFloat(comp.marginTop) || 0;
    const mr = parseFloat(comp.marginRight) || 0;
    const mb = parseFloat(comp.marginBottom) || 0;
    const ml = parseFloat(comp.marginLeft) || 0;

    const pt = parseFloat(comp.paddingTop) || 0;
    const pr = parseFloat(comp.paddingRight) || 0;
    const pb = parseFloat(comp.paddingBottom) || 0;
    const pl = parseFloat(comp.paddingLeft) || 0;

    if (mt > 0) marginOverlays.top.style.cssText = `display: block; left: ${pageX}px; top: ${pageY - mt}px; width: ${rect.width}px; height: ${mt}px;`;
    else marginOverlays.top.style.display = 'none';

    if (mr > 0) marginOverlays.right.style.cssText = `display: block; left: ${pageX + rect.width}px; top: ${pageY}px; width: ${mr}px; height: ${rect.height}px;`;
    else marginOverlays.right.style.display = 'none';

    if (mb > 0) marginOverlays.bottom.style.cssText = `display: block; left: ${pageX}px; top: ${pageY + rect.height}px; width: ${rect.width}px; height: ${mb}px;`;
    else marginOverlays.bottom.style.display = 'none';

    if (ml > 0) marginOverlays.left.style.cssText = `display: block; left: ${pageX - ml}px; top: ${pageY}px; width: ${ml}px; height: ${rect.height}px;`;
    else marginOverlays.left.style.display = 'none';

    if (pt > 0) paddingOverlays.top.style.cssText = `display: block; left: ${pageX}px; top: ${pageY}px; width: ${rect.width}px; height: ${pt}px;`;
    else paddingOverlays.top.style.display = 'none';

    if (pr > 0) paddingOverlays.right.style.cssText = `display: block; left: ${pageX + rect.width - pr}px; top: ${pageY}px; width: ${pr}px; height: ${rect.height}px;`;
    else paddingOverlays.right.style.display = 'none';

    if (pb > 0) paddingOverlays.bottom.style.cssText = `display: block; left: ${pageX}px; top: ${pageY + rect.height - pb}px; width: ${rect.width}px; height: ${pb}px;`;
    else paddingOverlays.bottom.style.display = 'none';

    if (pl > 0) paddingOverlays.left.style.cssText = `display: block; left: ${pageX}px; top: ${pageY}px; width: ${pl}px; height: ${rect.height}px;`;
    else paddingOverlays.left.style.display = 'none';
  }

  function hideSpacingOverlays() {
    Object.values(marginOverlays).forEach(o => o.style.display = 'none');
    Object.values(paddingOverlays).forEach(o => o.style.display = 'none');
  }

  function getSelectionStylesMap(el) {
    const comp = window.getComputedStyle(el);
    return {
      'width': el.style.width || comp.width,
      'height': el.style.height || comp.height,
      'max-width': el.style.maxWidth || comp.maxWidth,
      'margin-top': el.style.marginTop || comp.marginTop,
      'margin-right': el.style.marginRight || comp.marginRight,
      'margin-bottom': el.style.marginBottom || comp.marginBottom,
      'margin-left': el.style.marginLeft || comp.marginLeft,
      'padding-top': el.style.paddingTop || comp.paddingTop,
      'padding-right': el.style.paddingRight || comp.paddingRight,
      'padding-bottom': el.style.paddingBottom || comp.paddingBottom,
      'padding-left': el.style.paddingLeft || comp.paddingLeft,
      'gap': el.style.gap || comp.gap,
      'border-radius': el.style.borderRadius || comp.borderRadius,
      'font-size': el.style.fontSize || comp.fontSize,
      'position': el.style.position || comp.position,
      'left': el.style.left || comp.left,
      'top': el.style.top || comp.top,
      'display': el.style.display || comp.display,
      'align-items': el.style.alignItems || comp.alignItems,
      'justify-content': el.style.justifyContent || comp.justifyContent
    };
  }

  function onMouseMove(e) {
    if (!selectedElement) return;

    const deltaX = e.clientX - dragStart.x;
    const deltaY = e.clientY - dragStart.y;
    const el = selectedElement;

    if (isResizing) {
      let w = elemStart.width;
      let h = elemStart.height;

      if (activeHandle.includes('r')) w = elemStart.width + deltaX;
      if (activeHandle.includes('b')) h = elemStart.height + deltaY;
      if (activeHandle.includes('l')) w = elemStart.width - deltaX;
      if (activeHandle.includes('t')) h = elemStart.height - deltaY;

      w = Math.max(10, w);
      h = Math.max(10, h);

      el.style.width = w + 'px';
      el.style.height = h + 'px';

      dragStyles['width'] = w + 'px';
      dragStyles['height'] = h + 'px';

    } else if (isDragging) {
      const comp = window.getComputedStyle(el);
      const pos = comp.position;

      if (pos === 'absolute' || pos === 'relative' || pos === 'fixed' || pos === 'sticky') {
        const x = elemStart.left + deltaX;
        const y = elemStart.top + deltaY;
        el.style.left = x + 'px';
        el.style.top = y + 'px';

        dragStyles['left'] = x + 'px';
        dragStyles['top'] = y + 'px';
      } else {
        const mx = elemStart.marginLeft + deltaX;
        const my = elemStart.marginTop + deltaY;
        el.style.marginLeft = mx + 'px';
        el.style.marginTop = my + 'px';

        dragStyles['margin-left'] = mx + 'px';
        dragStyles['margin-top'] = my + 'px';
      }
    }

    updateSelectionBox();

    if (!isIframeView) {
      for (const prop in dragStyles) {
        if (inputs[prop]) inputs[prop].value = dragStyles[prop];
      }
    }

    window.dispatchEvent(new Event('resize'));
  }

  function onMouseUp() {
    isDragging = false;
    isResizing = false;
    activeHandle = null;

    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);

    const el = selectedElement;
    if (!el) return;

    // Clear inline visual scratch styles
    el.style.width = '';
    el.style.height = '';
    el.style.left = '';
    el.style.top = '';
    el.style.marginLeft = '';
    el.style.marginTop = '';

    if (Object.keys(dragStyles).length > 0) {
      if (!isIframeView) {
        // Parent: Commit style changes locally
        const selector = getActiveScopeSelector();
        
        if (stateBeforeAction) {
          undoStack.push(stateBeforeAction);
          if (undoStack.length > MAX_HISTORY) undoStack.shift();
          redoStack.length = 0;
          document.getElementById('tb-undo').disabled = false;
          document.getElementById('tb-redo').disabled = true;
          changesMade = true;
        }

        if (!currentConfig[activeBreakpoint][selector]) {
          currentConfig[activeBreakpoint][selector] = {};
        }
        
        const overrides = currentConfig[activeBreakpoint][selector];
        for (const prop in dragStyles) {
          overrides[prop] = dragStyles[prop];
        }

        updateStyleTagOverrides();
        if (isSimulatorActive) syncConfigToIframe();
      } else {
        // Iframe: Send mutation coordinates to parent for save/logging
        window.parent.postMessage({
          type: 'iframe_element_mutated',
          styles: dragStyles
        }, '*');
      }
    }

    stateBeforeAction = null;
    dragStyles = {};

    updateSelectionBox();
    const comp = window.getComputedStyle(el);
    if (!isIframeView) {
      refreshSidebarInputs(comp);
    }
    window.dispatchEvent(new Event('resize'));
  }

  function onTouchMove(e) {
    if (!selectedElement || e.touches.length === 0) return;
    const touch = e.touches[0];
    onMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
    e.preventDefault();
  }

  function onTouchEnd() {
    document.removeEventListener('touchmove', onTouchMove);
    document.removeEventListener('touchend', onTouchEnd);
    onMouseUp();
  }

  // ==========================================
  // BRANCH A ONLY: IFRAME MESSAGES HANDLER
  // ==========================================
  function setupIframeMessageListener() {
    window.addEventListener('message', (e) => {
      const data = e.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'parent_style_update') {
        liveStyleTag.textContent = data.css;
        updateSelectionBox();
        window.dispatchEvent(new Event('resize'));
      } else if (data.type === 'parent_sync') {
        currentConfig = data.config;
        liveStyleTag.textContent = data.css;
        updateSelectionBox();
        
        if (selectedElement) {
          const styles = getSelectionStylesMap(selectedElement);
          window.parent.postMessage({
            type: 'iframe_element_selected',
            selector: selectedSelector,
            tagName: selectedTagName,
            classList: selectedClassList,
            styles: styles
          }, '*');
        }
        window.dispatchEvent(new Event('resize'));
      } else if (data.type === 'parent_reset_element') {
        if (selectedElement) {
          selectedElement.removeAttribute('style');
          deselectElement();
        }
      }
    });
  }

  // ==========================================
  // BRANCH B ONLY: PARENT UI BUILDER & ENGINE
  // ==========================================

  const devices = {
    'galaxy-a35': { width: '384px', height: '670px', name: 'Galaxy A35 5G' },
    'galaxy-s24': { width: '360px', height: '640px', name: 'Galaxy S24' },
    'galaxy-s24-ultra': { width: '412px', height: '740px', name: 'Galaxy S24 Ultra' },
    'iphone-se': { width: '375px', height: '568px', name: 'iPhone SE' },
    'iphone-13-14': { width: '390px', height: '720px', name: 'iPhone 13 / 14' },
    'iphone-15-pro': { width: '393px', height: '730px', name: 'iPhone 15 Pro' },
    'iphone-15-promax': { width: '430px', height: '800px', name: 'iPhone 15 Pro Max' }
  };

  function setupEditorPanels() {
    // 1. Sidebar properties UI
    sidebar = document.createElement('div');
    sidebar.id = 'editor-sidebar-panel';
    sidebar.className = 'editor-reset';
    sidebar.innerHTML = `
      <div class="sidebar-header">
        <h3>Active Element</h3>
        <button class="minimize-btn" id="btn-minimize-panel" title="Minimize Panel">×</button>
      </div>
      
      <div class="sidebar-content-wrapper">
        <div class="sidebar-section active-element-section">
          <div class="selected-element-box">
            <span id="selected-tag" class="element-tag">None selected</span>
            <span id="selected-selector" class="element-selector">Click on any page element to select it and start editing.</span>
          </div>
          <div class="scope-toggle-wrapper">
            <label>Scope of Changes</label>
            <div class="scope-toggle-buttons">
              <button class="scope-btn active" id="scope-element" title="Apply to this specific element path">Element Only</button>
              <button class="scope-btn" id="scope-class" title="Apply to all elements sharing this class">All with Class</button>
            </div>
          </div>
        </div>

        <div class="sidebar-accordion">
          <!-- Sizing -->
          <div class="sidebar-section active">
            <div class="section-title"><span>📏 Sizing</span><span class="chevron">▼</span></div>
            <div class="section-content">
              <div class="control-group">
                <label>Width</label>
                <div class="input-row">
                  <input type="range" id="prop-width-range" min="0" max="1200" step="5" value="0">
                  <input type="text" id="prop-width" placeholder="auto" data-prop="width">
                </div>
              </div>
              <div class="control-group">
                <label>Height</label>
                <div class="input-row">
                  <input type="range" id="prop-height-range" min="0" max="800" step="5" value="0">
                  <input type="text" id="prop-height" placeholder="auto" data-prop="height">
                </div>
              </div>
              <div class="control-group">
                <label>Max Width</label>
                <div class="input-row">
                  <input type="range" id="prop-max-width-range" min="0" max="1500" step="10" value="0">
                  <input type="text" id="prop-max-width" placeholder="none" data-prop="max-width">
                </div>
              </div>
            </div>
          </div>

          <!-- Spacing -->
          <div class="sidebar-section active">
            <div class="section-title"><span>📦 Spacing</span><span class="chevron">▼</span></div>
            <div class="section-content">
              <div class="spacing-box-layout">
                <div class="spacing-label">Margin</div>
                <div class="spacing-inputs margin-group">
                  <input type="text" id="prop-margin-top" class="spacing-input top" placeholder="0" data-prop="margin-top">
                  <div class="horizontal-inputs">
                    <input type="text" id="prop-margin-left" class="spacing-input left" placeholder="0" data-prop="margin-left">
                    <div class="spacing-box-inner">
                      <div class="spacing-label inner">Padding</div>
                      <div class="spacing-inputs padding-group">
                        <input type="text" id="prop-padding-top" class="spacing-input top" placeholder="0" data-prop="padding-top">
                        <div class="horizontal-inputs">
                          <input type="text" id="prop-padding-left" class="spacing-input left" placeholder="0" data-prop="padding-left">
                          <div class="center-content-indicator"></div>
                          <input type="text" id="prop-padding-right" class="spacing-input right" placeholder="0" data-prop="padding-right">
                        </div>
                        <input type="text" id="prop-padding-bottom" class="spacing-input bottom" placeholder="0" data-prop="padding-bottom">
                      </div>
                    </div>
                    <input type="text" id="prop-margin-right" class="spacing-input right" placeholder="0" data-prop="margin-right">
                  </div>
                  <input type="text" id="prop-margin-bottom" class="spacing-input bottom" placeholder="0" data-prop="margin-bottom">
                </div>
              </div>
              <div class="control-group" style="margin-top: 15px;">
                <label>Gap (Grid/Flex)</label>
                <div class="input-row">
                  <input type="range" id="prop-gap-range" min="0" max="100" step="1" value="0">
                  <input type="text" id="prop-gap" placeholder="none" data-prop="gap">
                </div>
              </div>
            </div>
          </div>

          <!-- Aesthetics -->
          <div class="sidebar-section">
            <div class="section-title"><span>🎨 Aesthetics &amp; Font</span><span class="chevron">▼</span></div>
            <div class="section-content">
              <div class="control-group">
                <label>Border Radius</label>
                <div class="input-row">
                  <input type="range" id="prop-border-radius-range" min="0" max="100" step="1" value="0">
                  <input type="text" id="prop-border-radius" placeholder="0px" data-prop="border-radius">
                </div>
              </div>
              <div class="control-group">
                <label>Font Size</label>
                <div class="input-row">
                  <input type="range" id="prop-font-size-range" min="8" max="72" step="1" value="16">
                  <input type="text" id="prop-font-size" placeholder="16px" data-prop="font-size">
                </div>
              </div>
            </div>
          </div>

          <!-- Position -->
          <div class="sidebar-section">
            <div class="section-title"><span>📍 Position</span><span class="chevron">▼</span></div>
            <div class="section-content">
              <div class="control-group">
                <label>Position Mode</label>
                <select id="prop-position-mode" data-prop="position">
                  <option value="static">static (default)</option>
                  <option value="relative">relative</option>
                  <option value="absolute">absolute</option>
                  <option value="fixed">fixed</option>
                  <option value="sticky">sticky</option>
                </select>
              </div>
              <div class="control-group">
                <label>Position X (Left)</label>
                <div class="input-row">
                  <input type="range" id="prop-left-range" min="-500" max="500" step="5" value="0">
                  <input type="text" id="prop-left" placeholder="auto" data-prop="left">
                </div>
              </div>
              <div class="control-group">
                <label>Position Y (Top)</label>
                <div class="input-row">
                  <input type="range" id="prop-top-range" min="-500" max="500" step="5" value="0">
                  <input type="text" id="prop-top" placeholder="auto" data-prop="top">
                </div>
              </div>
            </div>
          </div>

          <!-- Layout Mode -->
          <div class="sidebar-section">
            <div class="section-title"><span>📦 Layout Mode</span><span class="chevron">▼</span></div>
            <div class="section-content">
              <div class="control-group">
                <label>Display Mode</label>
                <select id="prop-display-mode" data-prop="display">
                  <option value="block">block</option>
                  <option value="flex">flex</option>
                  <option value="grid">grid</option>
                  <option value="inline-block">inline-block</option>
                  <option value="inline">inline</option>
                  <option value="none">none (hidden)</option>
                </select>
              </div>
              <div class="control-group layout-flex-only" style="display:none;">
                <label>Flex Align Items</label>
                <select id="prop-align-items" data-prop="align-items">
                  <option value="">default</option>
                  <option value="stretch">stretch</option>
                  <option value="center">center</option>
                  <option value="flex-start">flex-start</option>
                  <option value="flex-end">flex-end</option>
                </select>
              </div>
              <div class="control-group layout-flex-only" style="display:none;">
                <label>Flex Justify Content</label>
                <select id="prop-justify-content" data-prop="justify-content">
                  <option value="">default</option>
                  <option value="flex-start">flex-start</option>
                  <option value="center">center</option>
                  <option value="flex-end">flex-end</option>
                  <option value="space-between">space-between</option>
                  <option value="space-around">space-around</option>
                </select>
              </div>
            </div>
          </div>

        </div>
      </div>
    `;
    document.body.appendChild(sidebar);

    // 2. Toolbar UI
    toolbar = document.createElement('div');
    toolbar.id = 'editor-toolbar-header';
    toolbar.className = 'editor-reset';
    toolbar.innerHTML = `
      <div class="tb-left">
        <div class="tb-grip" id="tb-grip" title="Drag Toolbar">⋮⋮</div>
        <span class="tb-logo">🌙 MOON DESIGNER</span>
        <div class="tb-divider"></div>
        <button id="tb-undo" title="Undo (Ctrl+Z)" disabled>↩</button>
        <button id="tb-redo" title="Redo (Ctrl+Y)" disabled>↪</button>
        <button id="tb-reset" title="Reset Overrides" disabled>Reset</button>
      </div>
      
      <div class="tb-center">
        <select id="tb-device-select" class="tb-select-device">
          <option value="none">🖥️ Live View (Desktop)</option>
          <option value="galaxy-a35">📱 Galaxy A35 5G (384×854)</option>
          <option value="galaxy-s24">📱 Galaxy S24 (360×780)</option>
          <option value="galaxy-s24-ultra">📱 Galaxy S24 Ultra (412×892)</option>
          <option value="iphone-se">📱 iPhone SE (375×667)</option>
          <option value="iphone-13-14">📱 iPhone 13 / 14 (390×844)</option>
          <option value="iphone-15-pro">📱 iPhone 15 Pro (393×852)</option>
          <option value="iphone-15-promax">📱 iPhone 15 Pro Max (430×932)</option>
        </select>
        <div class="tb-divider"></div>
        <div class="tb-breakpoint-badge" id="tb-active-breakpoint">💻 Desktop View</div>
        <span class="tb-resolution-label" id="tb-resolution"></span>
      </div>
      
      <div class="tb-right">
        <div class="tb-autohide-wrapper">
          <input type="checkbox" id="tb-autohide-check">
          <label for="tb-autohide-check">Auto-hide</label>
        </div>
        <div class="tb-divider"></div>
        <button id="tb-export" class="tb-btn-sec">Export</button>
        <button id="tb-save" class="tb-btn-pri">Save</button>
        <button id="tb-exit" class="tb-btn-danger">Exit</button>
        <div class="tb-divider"></div>
        <button id="tb-collapse-btn" title="Collapse Toolbar">▲</button>
      </div>
    `;
    document.body.appendChild(toolbar);

    // 3. Export Modal UI
    modal = document.createElement('div');
    modal.id = 'editor-export-modal';
    modal.className = 'editor-reset';
    modal.innerHTML = `
      <div class="modal-card">
        <div class="modal-header">
          <h2>Export Styles</h2>
          <button id="modal-close-btn">&times;</button>
        </div>
        <div class="modal-body">
          <div class="tab-header">
            <button class="tab-btn active" data-tab="compiled-css">Compiled CSS</button>
            <button class="tab-btn" data-tab="config-json">JSON Config</button>
          </div>
          <div class="tab-content active" id="modal-tab-compiled-css">
            <pre><code id="code-css-display"></code></pre>
          </div>
          <div class="tab-content" id="modal-tab-config-json">
            <pre><code id="code-json-display"></code></pre>
          </div>
        </div>
        <div class="modal-footer">
          <button id="btn-copy-code" class="tb-btn-pri">Copy Code</button>
          <button id="btn-modal-close" class="tb-btn-sec">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // 4. Toast Notification UI
    toast = document.createElement('div');
    toast.id = 'editor-toast';
    toast.className = 'editor-reset';
    document.body.appendChild(toast);

    // 5. Expand Panel Bubble UI (when minimized)
    expandBubble = document.createElement('div');
    expandBubble.id = 'editor-expand-panel-bubble';
    expandBubble.className = 'editor-reset';
    expandBubble.innerHTML = '🌙 Layout Controls';
    expandBubble.style.display = 'none';
    document.body.appendChild(expandBubble);

    // 6. Expand Toolbar Bubble UI (when minimized)
    expandTBBubble = document.createElement('div');
    expandTBBubble.id = 'editor-expand-toolbar-bubble';
    expandTBBubble.className = 'editor-reset';
    expandTBBubble.innerHTML = '▼ Editor Menu';
    expandTBBubble.style.display = 'none';
    document.body.appendChild(expandTBBubble);

    setupUIPanelControlsListeners();
  }

  function setupUIPanelControlsListeners() {
    // Toolbar Dragging listeners
    const grip = document.getElementById('tb-grip');
    let isTBDragging = false;
    let tbDragStart = { x: 0, y: 0 };
    let tbStartPos = { left: 0, top: 0 };

    grip.addEventListener('mousedown', (e) => {
      isTBDragging = true;
      tbDragStart.x = e.clientX;
      tbDragStart.y = e.clientY;

      const rect = toolbar.getBoundingClientRect();
      tbStartPos.left = rect.left;
      tbStartPos.top = rect.top;

      toolbar.style.left = rect.left + 'px';
      toolbar.style.top = rect.top + 'px';
      toolbar.style.transform = 'none';
      toolbar.style.margin = '0';
      toolbar.style.right = 'auto';

      e.preventDefault();
      e.stopPropagation();

      document.addEventListener('mousemove', onTBMouseMove);
      document.addEventListener('mouseup', onTBMouseUp);
    });

    function onTBMouseMove(e) {
      if (!isTBDragging) return;
      const dx = e.clientX - tbDragStart.x;
      const dy = e.clientY - tbDragStart.y;
      toolbar.style.left = (tbStartPos.left + dx) + 'px';
      toolbar.style.top = (tbStartPos.top + dy) + 'px';
    }

    function onTBMouseUp() {
      isTBDragging = false;
      document.removeEventListener('mousemove', onTBMouseMove);
      document.removeEventListener('mouseup', onTBMouseUp);
    }

    grip.addEventListener('touchstart', (e) => {
      if (e.touches.length === 0) return;
      isTBDragging = true;
      const touch = e.touches[0];
      tbDragStart.x = touch.clientX;
      tbDragStart.y = touch.clientY;

      const rect = toolbar.getBoundingClientRect();
      tbStartPos.left = rect.left;
      tbStartPos.top = rect.top;

      toolbar.style.left = rect.left + 'px';
      toolbar.style.top = rect.top + 'px';
      toolbar.style.transform = 'none';
      toolbar.style.margin = '0';
      toolbar.style.right = 'auto';

      e.preventDefault();
      e.stopPropagation();

      document.addEventListener('touchmove', onTBTouchMove, { passive: false });
      document.addEventListener('touchend', onTBTouchEnd);
    }, { passive: false });

    function onTBTouchMove(e) {
      if (!isTBDragging || e.touches.length === 0) return;
      const touch = e.touches[0];
      const dx = touch.clientX - tbDragStart.x;
      const dy = touch.clientY - tbDragStart.y;
      toolbar.style.left = (tbStartPos.left + dx) + 'px';
      toolbar.style.top = (tbStartPos.top + dy) + 'px';
      e.preventDefault();
    }

    function onTBTouchEnd() {
      isTBDragging = false;
      document.removeEventListener('touchmove', onTBTouchMove);
      document.removeEventListener('touchend', onTBTouchEnd);
    }

    // Device Presets change listener
    const deviceSelect = document.getElementById('tb-device-select');
    deviceSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === 'none') {
        isSimulatorActive = false;
        document.body.classList.remove('editor-simulator-active');
        if (simulatorContainer) {
          simulatorContainer.style.display = 'none';
        }
        deselectElement();
        updateBreakpoint();
      } else {
        isSimulatorActive = true;
        document.body.classList.add('editor-simulator-active');
        window.scrollTo(0, 0); // Reset parent scroll
        const dev = devices[val];
        
        if (!simulatorContainer) {
          simulatorContainer = document.createElement('div');
          simulatorContainer.id = 'editor-simulator-container';
          simulatorContainer.className = 'editor-reset';
          simulatorContainer.innerHTML = `
            <div id="editor-device-frame">
              <iframe id="editor-simulator-iframe" src="index.html?edit=true&iframe_view=true"></iframe>
            </div>
          `;
          document.body.appendChild(simulatorContainer);
          simulatorIframe = document.getElementById('editor-simulator-iframe');
          simulatorIframe.onload = () => {
            if (simulatorIframe.contentWindow) {
              simulatorIframe.contentWindow.scrollTo(0, 0);
            }
            syncConfigToIframe();
          };
          
          // Setup ResizeObserver to scale frame inside container
          if (typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(() => {
              updateSimulatorScale();
            });
            ro.observe(simulatorContainer);
          } else {
            window.addEventListener('resize', updateSimulatorScale);
          }
        } else {
          simulatorContainer.style.display = 'flex';
          if (simulatorIframe && simulatorIframe.contentWindow) {
            simulatorIframe.contentWindow.scrollTo(0, 0);
          }
        }

        const frame = document.getElementById('editor-device-frame');
        frame.style.width = dev.width;
        frame.style.height = dev.height;

        const badge = document.getElementById('tb-active-breakpoint');
        badge.textContent = `📱 Mobile: ${dev.name}`;
        badge.className = 'tb-breakpoint-badge mobile';
        document.getElementById('tb-resolution').textContent = `${dev.width} × ${dev.height}`;
        activeBreakpoint = 'mobile';

        updateSimulatorScale();
        syncConfigToIframe();
        deselectElement();
      }
    });

    // Toolbar collapse/expand
    document.getElementById('tb-collapse-btn').addEventListener('click', () => {
      toolbar.style.display = 'none';
      expandTBBubble.style.display = 'flex';
      document.body.classList.add('editor-toolbar-collapsed');
      updateSimulatorScale();
    });

    expandTBBubble.addEventListener('click', () => {
      expandTBBubble.style.display = 'none';
      toolbar.style.display = 'flex';
      document.body.classList.remove('editor-toolbar-collapsed');
      updateSimulatorScale();
    });

    // Sidebar panels minimize/expand
    document.getElementById('btn-minimize-panel').addEventListener('click', () => {
      sidebar.style.display = 'none';
      expandBubble.style.display = 'flex';
      document.body.classList.add('editor-sidebar-collapsed');
      updateSimulatorScale();
    });

    expandBubble.addEventListener('click', () => {
      expandBubble.style.display = 'none';
      sidebar.style.display = 'block';
      document.body.classList.remove('editor-sidebar-collapsed');
      updateSimulatorScale();
    });

    // Auto-hide toolbar settings
    const autohideCheck = document.getElementById('tb-autohide-check');
    let isAutohideActive = false;

    autohideCheck.addEventListener('change', (e) => {
      isAutohideActive = e.target.checked;
      if (!isAutohideActive) {
        toolbar.classList.remove('autohidden');
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!isAutohideActive || isTBDragging) return;
      const isOverToolbar = e.target.closest('#editor-toolbar-header');
      if (e.clientY <= 15 || isOverToolbar) {
        toolbar.classList.remove('autohidden');
      } else {
        toolbar.classList.add('autohidden');
      }
    });

    // Sidebar section accordion triggers
    document.querySelectorAll('#editor-sidebar-panel .section-title').forEach(title => {
      title.addEventListener('click', () => {
        title.parentElement.classList.toggle('active');
      });
    });

    // Exit visual editor mode
    document.getElementById('tb-exit').addEventListener('click', () => {
      if (changesMade) {
        if (confirm('You have unsaved changes. Discard them and exit?')) {
          exitEditor();
        }
      } else {
        exitEditor();
      }
    });

    function exitEditor() {
      window.location.href = window.location.pathname;
    }

    // Save configuration updates
    document.getElementById('tb-save').addEventListener('click', () => {
      const saveBtn = document.getElementById('tb-save');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      const compiledCSS = generateCompiledCSS();
      const payload = {
        config: currentConfig,
        css: compiledCSS
      };

      fetch('/save-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      .then(res => {
        if (!res.ok) throw new Error('Save API returned error status');
        return res.json();
      })
      .then(() => {
        showToastNotification('Changes saved to files successfully!');
        changesMade = false;
      })
      .catch(err => {
        console.error(err);
        showToastNotification('Error writing config to disk.', true);
      })
      .finally(() => {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
      });
    });

    // Undo/Redo/Reset
    document.getElementById('tb-undo').addEventListener('click', () => {
      if (undoStack.length === 0) return;
      const cur = JSON.stringify(currentConfig);
      redoStack.push(cur);
      document.getElementById('tb-redo').disabled = false;

      currentConfig = JSON.parse(undoStack.pop());
      if (undoStack.length === 0) document.getElementById('tb-undo').disabled = true;

      updateStyleTagOverrides();
      updateSelectionBox();
      if (selectedElement) {
        const comp = window.getComputedStyle(selectedElement);
        refreshSidebarInputs(comp);
      }
      if (isSimulatorActive) syncConfigToIframe();
      window.dispatchEvent(new Event('resize'));
    });

    document.getElementById('tb-redo').addEventListener('click', () => {
      if (redoStack.length === 0) return;
      const cur = JSON.stringify(currentConfig);
      undoStack.push(cur);
      document.getElementById('tb-undo').disabled = false;

      currentConfig = JSON.parse(redoStack.pop());
      if (redoStack.length === 0) document.getElementById('tb-redo').disabled = true;

      updateStyleTagOverrides();
      updateSelectionBox();
      if (selectedElement) {
        const comp = window.getComputedStyle(selectedElement);
        refreshSidebarInputs(comp);
      }
      if (isSimulatorActive) syncConfigToIframe();
      window.dispatchEvent(new Event('resize'));
    });

    document.getElementById('tb-reset').addEventListener('click', () => {
      if (!selectedSelector) return;
      
      const stateBeforeReset = JSON.stringify(currentConfig);
      undoStack.push(stateBeforeReset);
      if (undoStack.length > MAX_HISTORY) undoStack.shift();
      redoStack.length = 0;
      document.getElementById('tb-undo').disabled = false;
      document.getElementById('tb-redo').disabled = true;
      changesMade = true;

      const selector = getActiveScopeSelector();
      delete currentConfig.desktop[selector];
      delete currentConfig.tablet[selector];
      delete currentConfig.mobile[selector];

      updateStyleTagOverrides();
      updateSelectionBox();
      
      const comp = window.getComputedStyle(selectedElement);
      refreshSidebarInputs(comp);
      
      if (isSimulatorActive && simulatorIframe && simulatorIframe.contentWindow) {
        simulatorIframe.contentWindow.postMessage({
          type: 'parent_reset_element',
          selector: selector
        }, '*');
        syncConfigToIframe();
      }
      window.dispatchEvent(new Event('resize'));
    });

    // Scope modifications selection toggle
    document.getElementById('scope-element').addEventListener('click', () => {
      currentScope = 'element';
      document.getElementById('scope-element').classList.add('active');
      document.getElementById('scope-class').classList.remove('active');
      if (selectedElement) {
        const comp = window.getComputedStyle(selectedElement);
        refreshSidebarInputs(comp);
      }
      updateSelectionBox();
    });

    document.getElementById('scope-class').addEventListener('click', () => {
      if (selectedClassList.length === 0) return;
      currentScope = 'class';
      document.getElementById('scope-class').classList.add('active');
      document.getElementById('scope-element').classList.remove('active');
      if (selectedElement) {
        const comp = window.getComputedStyle(selectedElement);
        refreshSidebarInputs(comp);
      }
      updateSelectionBox();
    });

    // Export Modal buttons bindings
    document.getElementById('tb-export').addEventListener('click', () => {
      document.getElementById('code-css-display').textContent = generateCompiledCSS();
      document.getElementById('code-json-display').textContent = JSON.stringify(currentConfig, null, 2);
      modal.classList.add('open');
    });

    const closeModal = () => modal.classList.remove('open');
    document.getElementById('modal-close-btn').addEventListener('click', closeModal);
    document.getElementById('btn-modal-close').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    document.querySelectorAll('#editor-export-modal .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#editor-export-modal .tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('#editor-export-modal .tab-content').forEach(c => c.classList.remove('active'));

        btn.classList.add('active');
        document.getElementById(`modal-tab-${btn.dataset.tab}`).classList.add('active');
      });
    });

    document.getElementById('btn-copy-code').addEventListener('click', () => {
      const activeTab = document.querySelector('#editor-export-modal .tab-btn.active').dataset.tab;
      const text = activeTab === 'compiled-css' 
        ? document.getElementById('code-css-display').textContent 
        : document.getElementById('code-json-display').textContent;

      navigator.clipboard.writeText(text)
        .then(() => {
          const copyBtn = document.getElementById('btn-copy-code');
          const oldText = copyBtn.textContent;
          copyBtn.textContent = 'Copied!';
          copyBtn.disabled = true;
          setTimeout(() => {
            copyBtn.textContent = oldText;
            copyBtn.disabled = false;
          }, 1500);
        });
    });

    // Inputs bindings
    for (const prop in inputs) {
      const input = inputs[prop];
      
      input.addEventListener('input', (e) => {
        handlePropertyUpdate(prop, e.target.value);
        if (sliders[prop]) {
          const num = parseFloat(e.target.value);
          if (!isNaN(num)) sliders[prop].value = num;
        }
      });

      input.addEventListener('change', () => {
        commitPropertyChange();
      });
    }

    for (const prop in sliders) {
      const slider = sliders[prop];
      
      slider.addEventListener('input', (e) => {
        const val = e.target.value + 'px';
        inputs[prop].value = val;
        handlePropertyUpdate(prop, val);
      });

      slider.addEventListener('change', () => {
        commitPropertyChange();
      });
    }
  }

  // ==========================================
  // BRANCH B ONLY: SYNC OVERRIDES TO CONFIG
  // ==========================================
  function handlePropertyUpdate(prop, value) {
    if (!selectedSelector) return;

    const selector = getActiveScopeSelector();
    if (!currentConfig[activeBreakpoint][selector]) {
      currentConfig[activeBreakpoint][selector] = {};
    }

    const overrides = currentConfig[activeBreakpoint][selector];

    if (value === '' || value === undefined) {
      delete overrides[prop];
      if (Object.keys(overrides).length === 0) {
        delete currentConfig[activeBreakpoint][selector];
      }
    } else {
      overrides[prop] = value;
    }

    updateStyleTagOverrides();
    updateSelectionBox();

    // Toggle Flex Controls display
    if (prop === 'display') {
      const isFlex = value === 'flex' || value === 'inline-flex';
      document.querySelectorAll('.layout-flex-only').forEach(div => {
        div.style.display = isFlex ? 'block' : 'none';
      });
    }

    // Dynamic resize trigger for Rive Animations
    window.dispatchEvent(new Event('resize'));

    // Also notify iframe simulator if active
    if (isSimulatorActive && simulatorIframe && simulatorIframe.contentWindow) {
      simulatorIframe.contentWindow.postMessage({
        type: 'parent_style_update',
        css: generateCompiledCSS()
      }, '*');
    }
  }

  function commitPropertyChange() {
    if (!stateBeforeEdit) return;

    const currentState = JSON.stringify(currentConfig);
    if (stateBeforeEdit !== currentState) {
      undoStack.push(stateBeforeEdit);
      if (undoStack.length > MAX_HISTORY) undoStack.shift();
      redoStack.length = 0; // Clear redo

      document.getElementById('tb-undo').disabled = false;
      document.getElementById('tb-redo').disabled = true;
      changesMade = true;
    }
    stateBeforeEdit = null;

    if (isSimulatorActive) {
      syncConfigToIframe();
    }
  }

  // ==========================================
  // BRANCH B ONLY: INTER-WINDOW MESSAGES
  // ==========================================
  function setupParentMessageListener() {
    window.addEventListener('message', (e) => {
      const message = e.data;
      if (!message || typeof message !== 'object') return;

      if (message.type === 'iframe_element_selected') {
        selectedSelector = message.selector;
        selectedTagName = message.tagName;
        selectedClassList = message.classList || [];

        document.getElementById('selected-tag').textContent = selectedTagName;
        document.getElementById('selected-selector').textContent = selectedSelector;

        document.getElementById('tb-reset').disabled = false;
        document.querySelectorAll('#editor-sidebar-panel input, #editor-sidebar-panel select').forEach(input => {
          input.removeAttribute('disabled');
        });

        const scopeClassBtn = document.getElementById('scope-class');
        if (selectedClassList.length > 0) {
          scopeClassBtn.disabled = false;
          scopeClassBtn.textContent = `All with .${selectedClassList[0]}`;
        } else {
          scopeClassBtn.disabled = true;
          scopeClassBtn.textContent = 'All with Class';
          currentScope = 'element';
          document.getElementById('scope-element').classList.add('active');
          scopeClassBtn.classList.remove('active');
        }

        refreshSidebarInputs(message.styles);

      } else if (message.type === 'iframe_element_deselected') {
        deselectElement();

      } else if (message.type === 'iframe_drag_start') {
        stateBeforeAction = JSON.stringify(currentConfig);

      } else if (message.type === 'iframe_element_mutated') {
        const selector = getActiveScopeSelector();
        
        if (stateBeforeAction) {
          undoStack.push(stateBeforeAction);
          if (undoStack.length > MAX_HISTORY) undoStack.shift();
          redoStack.length = 0;
          document.getElementById('tb-undo').disabled = false;
          document.getElementById('tb-redo').disabled = true;
          changesMade = true;
        }

        if (!currentConfig[activeBreakpoint][selector]) {
          currentConfig[activeBreakpoint][selector] = {};
        }
        
        const overrides = currentConfig[activeBreakpoint][selector];
        for (const prop in message.styles) {
          overrides[prop] = message.styles[prop];
        }

        updateStyleTagOverrides();
        syncConfigToIframe();
        refreshSidebarInputs(overrides);
        
        stateBeforeAction = null;
      }
    });
  }

  // ==========================================
  // BRANCH B ONLY: AUTODETECT VIEWPORT BREAKPOINTS
  // ==========================================
  function setupBreakpointDetection() {
    function updateBreakpoint() {
      if (isSimulatorActive) return; // Managed by simulator frame size instead

      const w = window.innerWidth;
      const h = window.innerHeight;
      document.getElementById('tb-resolution').textContent = `${w}px × ${h}px`;

      let bpText = '🖥️ Desktop View';
      let bp = 'desktop';

      if (w <= 768) {
        bpText = '📱 Mobile View';
        bp = 'mobile';
      } else if (w <= 1024) {
        bpText = '📁 Tablet View';
        bp = 'tablet';
      }

      if (activeBreakpoint !== bp) {
        activeBreakpoint = bp;
        document.getElementById('tb-active-breakpoint').className = `tb-breakpoint-badge ${bp}`;
        document.getElementById('tb-active-breakpoint').textContent = bpText;
        
        if (selectedElement) {
          const comp = window.getComputedStyle(selectedElement);
          refreshSidebarInputs(comp);
        }
      }
      updateSelectionBox();
    }
    
    window.addEventListener('resize', updateBreakpoint);
    updateBreakpoint();
  }

  function updateStyleTagOverrides() {
    liveStyleTag.textContent = generateCompiledCSS();
  }

  function generateCompiledCSS() {
    let css = '/* Compiled Layout Overrides Generated by Moon Designer */\n\n';

    const bpConfigs = [
      { key: 'desktop', query: '@media (min-width: 1025px)' },
      { key: 'tablet', query: '@media (min-width: 769px) and (max-width: 1024px)' },
      { key: 'mobile', query: '@media (max-width: 768px)' }
    ];

    bpConfigs.forEach(bp => {
      const rules = currentConfig[bp.key];
      if (rules && Object.keys(rules).length > 0) {
        css += `${bp.query} {\n`;
        for (const selector in rules) {
          css += `  ${selector} {\n`;
          for (const prop in rules[selector]) {
            const val = rules[selector][prop];
            if (val !== '') {
              css += `    ${prop}: ${val} !important;\n`;
            }
          }
          css += `  }\n`;
        }
        css += `}\n\n`;
      }
    });

    return css;
  }

  function refreshSidebarInputs(fallbackStyles = {}) {
    const selector = getActiveScopeSelector();
    const activeOverrides = currentConfig[activeBreakpoint][selector] || {};

    for (const prop in inputs) {
      const input = inputs[prop];
      const val = activeOverrides[prop] !== undefined ? activeOverrides[prop] : (fallbackStyles[prop] || '');
      input.value = val;

      if (sliders[prop]) {
        const num = parseFloat(val);
        if (!isNaN(num)) sliders[prop].value = num;
        else sliders[prop].value = sliders[prop].min || 0;
      }
    }
  }

  function showToastNotification(msg, isErr = false) {
    toast.textContent = msg;
    toast.style.background = isErr ? 'rgba(239, 68, 68, 0.95)' : 'rgba(16, 185, 129, 0.95)';
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3500);
  }

  function syncConfigToIframe() {
    if (simulatorIframe && simulatorIframe.contentWindow) {
      simulatorIframe.contentWindow.postMessage({
        type: 'parent_sync',
        config: currentConfig,
        css: generateCompiledCSS()
      }, '*');
    }
  }

  function updateSimulatorScale() {
    if (!isSimulatorActive || !simulatorContainer) return;
    const frame = document.getElementById('editor-device-frame');
    if (!frame) return;

    const deviceSelect = document.getElementById('tb-device-select');
    if (!deviceSelect) return;
    const val = deviceSelect.value;
    const dev = devices[val];
    if (!dev) return;

    const devW = parseInt(dev.width);
    const devH = parseInt(dev.height);

    const frameW = devW + 28;
    const frameH = devH + 28;

    const containerW = simulatorContainer.clientWidth;
    const containerH = simulatorContainer.clientHeight;

    const scaleX = containerW / frameW;
    const scaleY = containerH / frameH;
    const scale = Math.min(1, scaleX, scaleY) * 0.95;

    frame.style.transform = `scale(${scale})`;
    frame.style.transformOrigin = 'center center';
  }

  // ==========================================
  // KEYBOARD & SCROLL HANDLERS (SHARED / BRIDGED)
  // ==========================================
  window.addEventListener('keydown', (e) => {
    // Shortcuts (Ignore if iframe view, handled by parent)
    if (isIframeView) return;

    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      document.getElementById('tb-undo').click();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
      e.preventDefault();
      document.getElementById('tb-redo').click();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      document.getElementById('tb-save').click();
      return;
    }

    if (!selectedElement) return;

    let dx = 0;
    let dy = 0;
    const step = e.shiftKey ? 10 : 1;

    if (e.key === 'ArrowUp') dy = -step;
    else if (e.key === 'ArrowDown') dy = step;
    else if (e.key === 'ArrowLeft') dx = -step;
    else if (e.key === 'ArrowRight') dx = step;
    else return;

    e.preventDefault();

    const el = selectedElement;
    const comp = window.getComputedStyle(el);
    const pos = comp.position;
    const modified = {};

    if (pos === 'absolute' || pos === 'relative' || pos === 'fixed' || pos === 'sticky') {
      modified['left'] = ((parseFloat(comp.left) || 0) + dx) + 'px';
      modified['top'] = ((parseFloat(comp.top) || 0) + dy) + 'px';
    } else {
      modified['margin-left'] = ((parseFloat(comp.marginLeft) || 0) + dx) + 'px';
      modified['margin-top'] = ((parseFloat(comp.marginTop) || 0) + dy) + 'px';
    }

    // Save history point before nudge
    const stateBeforeNudge = JSON.stringify(currentConfig);
    const selector = getActiveScopeSelector();

    if (!currentConfig[activeBreakpoint][selector]) {
      currentConfig[activeBreakpoint][selector] = {};
    }
    
    const overrides = currentConfig[activeBreakpoint][selector];
    for (const prop in modified) {
      overrides[prop] = modified[prop];
    }

    undoStack.push(stateBeforeNudge);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
    
    document.getElementById('tb-undo').disabled = false;
    document.getElementById('tb-redo').disabled = true;
    changesMade = true;

    updateStyleTagOverrides();
    updateSelectionBox();
    const compStyles = window.getComputedStyle(el);
    refreshSidebarInputs(compStyles);
    
    if (isSimulatorActive) syncConfigToIframe();
    window.dispatchEvent(new Event('resize'));
  });

  window.addEventListener('scroll', () => {
    updateSelectionBox();
  });

})();
