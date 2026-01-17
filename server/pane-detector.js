const { Jimp } = require('jimp');
const configManager = require('./configManager');

// Helper to get sample step based on low-resource mode
function getLowResourceSampleStep(defaultStep) {
    return configManager.isLowResourceMode() ? Math.max(15, defaultStep * 2) : defaultStep;
}

/**
 * Finds vertical edges (separators) by detecting horizontal color transitions.
 * This works regardless of theme (light/dark) because it looks for color CHANGES,
 * not specific colors.
 * 
 * @param {Jimp} image 
 * @param {Object} options
 * @returns {Array<{x: number, edgeScore: number, continuity: number}>}
 */
function findVerticalEdges(image, options = {}) {
    const {
        minEdgeScore = 0.60,      // Minimum 60% of sampled points must show an edge
        edgeThreshold = 25,       // Minimum color difference to count as edge
        sampleStep = getLowResourceSampleStep(5),  // Adaptive based on mode
        marginX = 30,             // Skip pixels near edges
        marginY = 30              // Skip pixels near top/bottom
    } = options;

    const width = image.width;
    const height = image.height;
    const edges = [];

    // Determine scan range (ROI)
    let startX = width - marginX;
    let endX = width * 0.3;

    if (options.fullWidth) {
        startX = width - marginX;
        endX = marginX;
    } else if (options.scanRegion) {
        // scanRegion: { x, width } center and width of the region to scan
        startX = Math.min(width - 5, options.scanRegion.x + options.scanRegion.width / 2);
        endX = Math.max(5, options.scanRegion.x - options.scanRegion.width / 2);
    }

    // Scan from right to left
    for (let x = startX; x > endX; x--) {
        let edgeCount = 0;
        let totalSamples = 0;

        for (let y = marginY; y < height - marginY; y += sampleStep) {
            // Compare pixels to the LEFT and RIGHT of this X position
            const leftX = Math.max(0, x - 3);
            const rightX = Math.min(width - 1, x + 3);

            const leftColor = intToRGBA(image.getPixelColor(leftX, y));
            const rightColor = intToRGBA(image.getPixelColor(rightX, y));

            const diff = colorDiff(leftColor, rightColor);

            if (diff > edgeThreshold) {
                edgeCount++;
            }
            totalSamples++;
        }

        const edgeScore = totalSamples > 0 ? edgeCount / totalSamples : 0;

        if (edgeScore >= minEdgeScore) {
            edges.push({ x, edgeScore, continuity: edgeScore });
        }
    }

    // Remove duplicates within 5px of each other, keeping highest score
    const filtered = [];
    for (const edge of edges) {
        const existing = filtered.find(e => Math.abs(e.x - edge.x) < 5);
        if (!existing) {
            filtered.push(edge);
        } else if (edge.edgeScore > existing.edgeScore) {
            existing.x = edge.x;
            existing.edgeScore = edge.edgeScore;
        }
    }

    return filtered.sort((a, b) => b.x - a.x); // Sort by X descending
}

/**
 * Finds the chat pane using edge detection.
 * No calibration needed - works with any theme.
 * 
 * @param {Jimp} image - The cropped IDE window image
 * @returns {{ x: number, y: number, width: number, height: number } | null}
 */
async function findChatPaneStructural(image, options = {}) {
    // themeConfig is ignored - we use edge detection now
    const width = image.width;
    const height = image.height;
    const quiet = options.quiet || false;

    if (!quiet) console.log(`Finding chat pane in ${width}x${height} image...`);

    // 1. Find vertical edges (separators)
    const edgeOptions = {
        minEdgeScore: 0.50,      // At least 50% of height shows edge
        edgeThreshold: 20,       // Color difference threshold
        sampleStep: getLowResourceSampleStep(8)  // Adaptive based on mode
    };

    if (options.scanRegion) {
        edgeOptions.scanRegion = options.scanRegion;
    }

    const verticalEdges = findVerticalEdges(image, edgeOptions);

    if (verticalEdges.length === 0) {
        if (!quiet) console.log('No vertical edges found');
        return null;
    }

    // Sort edges for log display but use filtering logic for selection
    if (!quiet) {
        console.log(`Found ${verticalEdges.length} vertical edge candidates:`);
        verticalEdges.slice(0, 3).forEach((e, i) => { // Limit log lines
            console.log(`  ${i + 1}. X=${e.x}, score=${(e.edgeScore * 100).toFixed(1)}%`);
        });
    }

    // 2. Take the rightmost valid edge as the chat separator
    // If scanning a specific region, we don't need excessive filtering for scrollbars
    // as the region is already presumed valid-ish. But safety checks are good.

    let validEdges = verticalEdges;

    if (!options.scanRegion) {
        // Global scan: Filter out edges that are too close to margins
        const rightMarginThreshold = width * 0.90; // Ignore edges in rightmost 10%
        const leftMinThreshold = width * 0.35;     // Must be at least 35% from left

        validEdges = verticalEdges.filter(e =>
            e.x < rightMarginThreshold &&
            e.x > leftMinThreshold
        );
    }

    if (validEdges.length === 0) {
        if (!quiet) console.log('No valid edges after filtering');
        return null;
    }

    // Among valid edges, prefer the one with highest score, not just rightmost
    validEdges.sort((a, b) => {
        // If scores are similar (within 10%), prefer rightmost
        if (Math.abs(a.edgeScore - b.edgeScore) < 0.10) {
            return b.x - a.x; // Rightmost first
        }
        return b.edgeScore - a.edgeScore; // Highest score first
    });

    const bestEdge = validEdges[0];
    if (!quiet) console.log(`Selected separator at X=${bestEdge.x} (score: ${(bestEdge.edgeScore * 100).toFixed(1)}%)`);

    // 3. Find horizontal bounds (optional - for now use full height)
    // We could detect horizontal edges similarly, but for chat it's usually full height
    const topY = 0;
    const bottomY = height;

    return {
        x: bestEdge.x,
        y: topY,
        width: width - bestEdge.x,
        height: bottomY - topY
    };
}

/**
 * Legacy calibration function - kept for backward compatibility.
 * Now returns null as we don't need calibration with edge detection.
 */
async function calibrateTheme(image) {
    // Edge detection doesn't need calibration
    console.log('Calibration skipped - using edge detection');
    return { color: { r: 128, g: 128, b: 128 }, width: 1, confidence: 100 };
}


/**
 * Finds horizontal edges (separators) by detecting vertical color transitions.
 * @param {Jimp} image
 * @param {Object} options
 */
function findHorizontalEdges(image, options = {}) {
    const {
        minEdgeScore = 0.60,      // Minimum 60% of sampled points must show an edge
        edgeThreshold = 25,       // Minimum color difference to count as edge
        sampleStep = getLowResourceSampleStep(5),  // Adaptive based on mode
        marginX = 30,             // Skip pixels near sides
        marginY = 30              // Skip pixels near top/bottom
    } = options;

    const width = image.width;
    const height = image.height;
    const edges = [];

    // Determine scan range (ROI) - Scan from Bottom to Top (terminal is at bottom)
    let startY = height - 5; // Scan almost to the very bottom to catch status bar if we wanted (filtered later)
    let endY = height * 0.3; // Scan up to 30% from top (terminal can be very large)

    if (options.scanRegion) {
        startY = Math.min(height - 5, options.scanRegion.y + options.scanRegion.height / 2);
        endY = Math.max(5, options.scanRegion.y - options.scanRegion.height / 2);
    }

    for (let y = startY; y > endY; y--) {
        let edgeCount = 0;
        let totalSamples = 0;

        for (let x = marginX; x < width - marginX; x += sampleStep) {
            // Compare pixels ABOVE and BELOW this Y position
            const topY = Math.max(0, y - 3);
            const bottomY = Math.min(height - 1, y + 3);

            const topColor = intToRGBA(image.getPixelColor(x, topY));
            const bottomColor = intToRGBA(image.getPixelColor(x, bottomY));

            const diff = colorDiff(topColor, bottomColor);

            if (diff > edgeThreshold) {
                edgeCount++;
            }
            totalSamples++;
        }

        const edgeScore = totalSamples > 0 ? edgeCount / totalSamples : 0;

        if (edgeScore >= minEdgeScore) {
            edges.push({ y, edgeScore, continuity: edgeScore });
        }
    }

    // Filter duplicates
    const filtered = [];
    for (const edge of edges) {
        const existing = filtered.find(e => Math.abs(e.y - edge.y) < 5);
        if (!existing) {
            filtered.push(edge);
        } else if (edge.edgeScore > existing.edgeScore) {
            existing.y = edge.y;
            existing.edgeScore = edge.edgeScore;
        }
    }

    return filtered.sort((a, b) => b.y - a.y); // Sort by Y descending
}

async function findTerminalPane(image, options = {}) {
    const width = image.width;
    const height = image.height;
    const quiet = options.quiet || false;

    if (!quiet) console.log(`Finding terminal pane in ${width}x${height} image...`);

    const edgeOptions = {
        minEdgeScore: 0.50,
        edgeThreshold: 20,
        sampleStep: getLowResourceSampleStep(8)  // Adaptive based on mode
    };

    if (options.scanRegion) {
        edgeOptions.scanRegion = options.scanRegion;
    }

    const horizontalEdges = findHorizontalEdges(image, edgeOptions);

    if (horizontalEdges.length === 0) {
        if (!quiet) console.log('No horizontal edges found');
        return null;
    }

    // 1. Find Top Separator (between editor and terminal panel)
    // We want the HIGHEST (smallest Y) horizontal edge that represents the panel top.
    // Heuristic: Scan from the bottom (above status bar) and find the first major separator.
    const statusBarThreshold = height - 40;  // Status bar is usually ~22-35px
    const minHeightThreshold = height * 0.30; // Terminals can be quite large, scan up to 30% from top

    let candidates = horizontalEdges.filter(e =>
        e.y > minHeightThreshold && e.y < statusBarThreshold
    ).sort((a, b) => b.y - a.y); // Sort by Y descending (bottom to top)

    if (candidates.length === 0) {
        if (!quiet) console.log('No valid terminal panel separator found');
        return null;
    }

    // Among candidates, we scan upwards to find the panel top (including tabs).
    // The "Top Separator" is the highest one in the group of close-together lines.
    // We increase the gap to 100px to ensure we bridge the gap between tabs and content.
    let topSeparator = candidates[0];
    const MAX_GAP = 100;

    for (let i = 1; i < candidates.length; i++) {
        const dist = Math.abs(candidates[i].y - candidates[i - 1].y);
        if (dist < MAX_GAP) {
            topSeparator = candidates[i]; // Keep going up if lines are close or within gap
        } else {
            // If we found a large gap AND we already have a decent height, we stop.
            // This prevents us from jumping into the editor area by accident.
            const currentHeight = candidates[0].y - candidates[i - 1].y;
            if (currentHeight > 80) break;

            // Otherwise, if we haven't found a panel yet, we might still be looking for the bottom of the content
            topSeparator = candidates[i];
        }
    }

    if (!quiet) console.log(`Selected top separator at Y=${topSeparator.y} (detected bottom-up)`);

    // 2. Find Bottom Separator (top of status bar)
    // We want the edge that separates the terminal from the status bar or taskbar.
    const bottomCandidates = horizontalEdges.filter(e =>
        e.y > topSeparator.y + 100 && // Must be below top panel
        e.y < height - 5 // Not the absolute bottom edge
    ).sort((a, b) => b.y - a.y); // Sort by Y descending (bottom to top)

    // The FIRST candidate from the bottom should be the top of the Status Bar (or Taskbar if no status bar).
    let bottomSeparatorY = height;
    if (bottomCandidates.length > 0) {
        bottomSeparatorY = bottomCandidates[0].y;

        // If the detected edge is very low, it might be the bottom of the status bar.
        // We look for the next one up if it's within a reasonable status bar height (30-50px).
        if (bottomCandidates.length > 1 && (height - bottomCandidates[0].y) < 25) {
            if (Math.abs(bottomCandidates[1].y - bottomCandidates[0].y) < 45) {
                bottomSeparatorY = bottomCandidates[1].y;
            }
        }
    } else {
        bottomSeparatorY = height - 25; // Fallback
    }

    const finalSliceHeight = bottomSeparatorY - topSeparator.y;
    const MIN_TERMINAL_HEIGHT = 120;

    if (finalSliceHeight < MIN_TERMINAL_HEIGHT) {
        if (!quiet) console.log(`Discarding detection: height ${finalSliceHeight} < ${MIN_TERMINAL_HEIGHT}`);
        return null;
    }

    if (!quiet) {
        console.log(`Final terminal slice: Y range [${topSeparator.y}, ${bottomSeparatorY}], height=${finalSliceHeight}`);
    }

    // 3. Find Vertical Separators (exclude sidebars on left and right)
    // We scan for vertical edges JUST within this horizontal slice
    const sliceHeight = bottomSeparatorY - topSeparator.y;
    if (sliceHeight < 30) return null; // Too small

    // Create a sub-image for vertical scanning to be precise
    const terminalSlice = image.clone().crop({
        x: 0,
        y: topSeparator.y,
        w: width,
        h: sliceHeight
    });

    const verticalEdges = findVerticalEdges(terminalSlice, {
        minEdgeScore: 0.40, // Score might be lower in small slice
        edgeThreshold: 20,
        sampleStep: 5,
        marginY: 5, // Scan almost full height of slice
        fullWidth: true // Search the ENTIRE width for sidebars
    });

    // We want the rightmost vertical separator (right sidebar) 
    // AND the leftmost vertical separator (left sidebar).
    const rightMargin = width * 0.98;
    const rightLimit = width * 0.4; // Right sidebar is usually in the right 60%
    const leftLimit = width * 0.02;  // Skip the absolute edge
    const leftMargin = width * 0.6; // Activity bar/Sidebar is usually in the left 40%

    // Right side candidates
    // Most likely separators: Terminal/Chat boundary OR Windows/UI edge
    // Usually the one further LEFT (smaller X) among high-scoring edges is the internal separator.
    const rightCandidates = verticalEdges.filter(e =>
        e.x < rightMargin && e.x > rightLimit
    ).sort((a, b) => {
        // Preference 1: Highest score
        // Preference 2: If scores are similar (within 10%), prefer the one further RIGHT (larger X)
        // This ensures we include the terminal's internal sidebar if it exists.
        if (Math.abs(a.edgeScore - b.edgeScore) < 0.10) {
            return b.x - a.x; // Larger X first
        }
        return b.edgeScore - a.edgeScore; // Highest score first
    });

    // Left side candidates
    // Most likely separators: Sidebar/Terminal boundary OR Activity Bar edge
    // Usually the one further RIGHT (larger X) among high-scoring edges is the internal separator.
    const leftCandidates = verticalEdges.filter(e =>
        e.x > leftLimit && e.x < leftMargin
    ).sort((a, b) => {
        // Preference 1: Highest score
        // Preference 2: If scores are similar (within 10%), prefer the one further RIGHT (larger X)
        // because the activity bar is leftmost and we want the edge between sidebar/terminal.
        if (Math.abs(a.edgeScore - b.edgeScore) < 0.10) {
            return b.x - a.x; // Larger X first
        }
        return b.edgeScore - a.edgeScore; // Highest score first
    });

    let finalRightX = width;
    if (rightCandidates.length > 0) {
        finalRightX = rightCandidates[0].x;
        if (!quiet) console.log(`Selected terminal RIGHT separator at X=${finalRightX} (score: ${(rightCandidates[0].edgeScore * 100).toFixed(1)}%)`);
    }

    let finalLeftX = 0;
    if (leftCandidates.length > 0) {
        finalLeftX = leftCandidates[0].x;
        if (!quiet) console.log(`Selected terminal LEFT separator at X=${finalLeftX} (score: ${(leftCandidates[0].edgeScore * 100).toFixed(1)}%)`);
    }

    const finalWidth = finalRightX - finalLeftX;

    return {
        x: finalLeftX,
        y: topSeparator.y,
        width: finalWidth,
        height: bottomSeparatorY - topSeparator.y
    };
}


// --- Helpers ---

function intToRGBA(i) {
    return {
        r: (i >>> 24) & 0xFF,
        g: (i >>> 16) & 0xFF,
        b: (i >>> 8) & 0xFF,
        a: i & 0xFF
    };
}

function colorDiff(c1, c2) {
    return Math.abs(c1.r - c2.r) + Math.abs(c1.g - c2.g) + Math.abs(c1.b - c2.b);
}

function rgbaToInt(r, g, b, a = 255) {
    // Use >>> 0 to convert to unsigned 32-bit integer
    return (((r & 0xFF) << 24) | ((g & 0xFF) << 16) | ((b & 0xFF) << 8) | (a & 0xFF)) >>> 0;
}

/**
 * Draws visual debug markers on the image showing detected edges.
 * RED lines = candidate separators (all detected edges)
 * GREEN overlay = selected chat pane region
 * @param {Jimp} image - The image to draw on (will be modified in place)
 * @param {Array} edges - Array of edge objects {x, edgeScore}
 * @param {number} selectedX - The X coordinate of the selected separator
 */
function drawDebugMarkers(image, edges, selectedPos, isHorizontal = false) {
    const height = image.height;
    const width = image.width;

    // Colors - use bright, visible colors
    const RED = rgbaToInt(255, 50, 50);       // Candidate separators
    const GREEN = rgbaToInt(0, 255, 100);     // Selected separator

    const selectedArray = Array.isArray(selectedPos) ? selectedPos : [selectedPos];

    if (!isHorizontal) {
        // --- VERTICAL MARKERS ---
        for (const edge of edges) {
            const isSelected = selectedArray.some(p => Math.abs(edge.x - p) < 5);
            if (isSelected) continue;

            for (let y = 0; y < height; y++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const x = edge.x + dx;
                    if (x >= 0 && x < width) image.setPixelColor(RED, x, y);
                }
            }
        }
        for (const pos of selectedArray) {
            if (pos >= 0 && pos < width) {
                for (let y = 0; y < height; y++) {
                    for (let dx = -2; dx <= 2; dx++) {
                        const x = Math.round(pos) + dx;
                        if (x >= 0 && x < width) image.setPixelColor(GREEN, x, y);
                    }
                }
            }
        }
    } else {
        // --- HORIZONTAL MARKERS ---
        for (const edge of edges) {
            const isSelected = selectedArray.some(p => Math.abs(edge.y - p) < 5);
            if (isSelected) continue;

            for (let x = 0; x < width; x++) {
                for (let dy = -1; dy <= 1; dy++) {
                    const y = edge.y + dy;
                    if (y >= 0 && y < height) image.setPixelColor(RED, x, y);
                }
            }
        }
        for (const pos of selectedArray) {
            if (pos >= 0 && pos < height) {
                for (let x = 0; x < width; x++) {
                    for (let dy = -2; dy <= 2; dy++) {
                        const y = Math.round(pos) + dy;
                        if (y >= 0 && y < height) image.setPixelColor(GREEN, x, y);
                    }
                }
            }
        }
    }
}

module.exports = { calibrateTheme, findChatPaneStructural, findVerticalEdges, findHorizontalEdges, findTerminalPane, drawDebugMarkers };

