import React, { useState, useRef, useEffect } from 'react';

const DraggableFab = ({ children, onClick, style, className, title, active }) => {
    const [pos, setPos] = useState(null); // { left, top }
    const buttonRef = useRef(null);

    // Drag state
    const isDragging = useRef(false);
    const dragStart = useRef(null); // { x, y } (pointer coords)
    const initialPos = useRef(null); // { left, top } (element coords)
    const longPressTimer = useRef(null);

    // Prevent default touch actions (scrolling) when dragging this element
    useEffect(() => {
        const btn = buttonRef.current;
        if (!btn) return;

        const preventDefault = (e) => {
            // Only prevent default if we are actually dragging or might be
            // But for a FAB, we generally don't want to scroll the page behind it when touching it
            e.preventDefault();
        };

        // We use passive: false to allow preventDefault
        btn.addEventListener('touchstart', preventDefault, { passive: false });
        // btn.addEventListener('touchmove', preventDefault, { passive: false });

        return () => {
            btn.removeEventListener('touchstart', preventDefault);
            // btn.removeEventListener('touchmove', preventDefault);
        };
    }, []);

    const handleStart = (clientX, clientY) => {
        isDragging.current = false;
        dragStart.current = { x: clientX, y: clientY };

        if (buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            // Important: We need the offset relative to the viewport (fixed) or container (absolute).
            // StreamCanvas container is relative, these are absolute inside it.
            // Since the container is full screen/div, getBoundingClientRect usually matches visual position.
            // We lock the position to 'left/top' mode once dragged.

            // If we haven't dragged yet (pos is null), we need to capture the CURRENT calculated position
            // (which comes from bottom/right css) and freeze it as left/top.
            const currentLeft = pos ? pos.left : rect.left;
            const currentTop = pos ? pos.top : rect.top;

            initialPos.current = { left: currentLeft, top: currentTop };
        }
    };

    const handleMove = (clientX, clientY) => {
        if (!dragStart.current || !initialPos.current) return;

        const dx = clientX - dragStart.current.x;
        const dy = clientY - dragStart.current.y;

        // Threshold to treat as drag
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
            isDragging.current = true;
        }

        if (isDragging.current) {
            // Update position
            const newLeft = initialPos.current.left + dx;
            const newTop = initialPos.current.top + dy;

            // Bounds Checking (Keep fully on screen approx)
            const btnSize = 48; // Approx size
            const maxLeft = window.innerWidth - btnSize;
            const maxTop = window.innerHeight - btnSize;

            setPos({
                left: Math.max(0, Math.min(newLeft, maxLeft)),
                top: Math.max(0, Math.min(newTop, maxTop))
            });
        }
    };

    const handleEnd = (e) => {
        dragStart.current = null;
        initialPos.current = null;

        // If not a drag, treat as click
        if (!isDragging.current) {
            if (onClick) onClick(e);
        }

        // Reset dragging flag after a short delay to prevent any follow-up events
        setTimeout(() => {
            isDragging.current = false;
        }, 50);
    };

    // Touch Handlers
    const onTouchStart = (e) => {
        // e.preventDefault(); // Handled by effect
        const touch = e.touches[0];
        handleStart(touch.clientX, touch.clientY);
    };

    const onTouchMove = (e) => {
        // e.preventDefault(); // Prevent scrolling check
        const touch = e.touches[0];
        handleMove(touch.clientX, touch.clientY);
    };

    const onTouchEnd = (e) => {
        handleEnd(e);
    };

    // Mouse Handlers (for desktop testing/usage)
    const onMouseDown = (e) => {
        handleStart(e.clientX, e.clientY);

        const onWindowMouseMove = (ev) => {
            handleMove(ev.clientX, ev.clientY);
        };

        const onWindowMouseUp = (ev) => {
            handleEnd(ev);
            window.removeEventListener('mousemove', onWindowMouseMove);
            window.removeEventListener('mouseup', onWindowMouseUp);
        };

        window.addEventListener('mousemove', onWindowMouseMove);
        window.addEventListener('mouseup', onWindowMouseUp);
    };

    // Merge styles
    const finalStyle = {
        ...style,
        // Override position if dragged
        ...(pos ? {
            left: `${pos.left}px`,
            top: `${pos.top}px`,
            bottom: 'auto',
            right: 'auto',
            transform: 'none' // clear any transforms if they exist
        } : {})
    };

    return (
        <button
            ref={buttonRef}
            className={className}
            style={finalStyle}
            title={title}
            // Bind listeners
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onMouseDown={onMouseDown}
        >
            {children}
        </button>
    );
};

export default DraggableFab;
