self.onmessage = function(e) {
    const { parks, userActivatedReferences = [], spotByRef = {}, potaFilters = {}, modeFilters = {} } = e.data || {};
    const results = [];
    const now = Date.now();

    function shouldDisplayParkFlags(flags){
        const isUserActivated = !!(flags && flags.isUserActivated);
        const isActive = !!(flags && flags.isActive);
        const isNew = !!(flags && flags.isNew);
        if (potaFilters.allParks){
            if (potaFilters.myActivations === false && isUserActivated) return false;
            if (potaFilters.currentlyActivating === false && isActive) return false;
            if (potaFilters.newParks === false && isNew) return false;
            return true;
        }
        const anySpecific = !!potaFilters.myActivations || !!potaFilters.currentlyActivating || !!potaFilters.newParks;
        if (!anySpecific) return false;
        return (potaFilters.myActivations && isUserActivated)
            || (potaFilters.currentlyActivating && isActive)
            || (potaFilters.newParks && isNew);
    }

    function shouldDisplayByMode(isActive, isNew, mode){
        if (!isActive) return true;
        if (isNew && !modeFilters.new) return false;
        let key = 'unk';
        if (mode === 'CW') key = 'cw';
        else if (mode === 'SSB') key = 'ssb';
        else if (mode === 'FT8' || mode === 'FT4') key = 'data';
        if (!modeFilters[key]) return false;
        return true;
    }

    function getColor(activations, isUserActivated, created){
        try {
            const createdDate = new Date(created);
            const ageInDays = isFinite(createdDate) ? ((now - createdDate.getTime()) / (1000 * 60 * 60 * 24)) : Infinity;
            if (ageInDays <= 30) return '#800080';
            if (isUserActivated) return '#00ff00';
            return '#ff6666';
        } catch(err){
            return '#ff6666';
        }
    }

    for (const park of parks || []) {
        if (!park || park.latitude == null || park.longitude == null) continue;
        const reference = park.reference;
        const currentActivation = spotByRef[reference] || null;
        const isUserActivated = userActivatedReferences.includes(reference);
        const parkActivationCount = park.activations || 0;
        const createdTime = park.created ? new Date(park.created).getTime() : 0;
        const isNew = createdTime && (now - createdTime <= 30 * 24 * 60 * 60 * 1000);
        const isActive = !!currentActivation;
        const mode = currentActivation && currentActivation.mode ? currentActivation.mode.toUpperCase() : '';
        if (!shouldDisplayParkFlags({ isUserActivated, isActive, isNew })) continue;
        if (!shouldDisplayByMode(isActive, isNew, mode)) continue;
        const fillColor = getColor(parkActivationCount, isUserActivated, park.created);
        const tooltipText = currentActivation
            ? `${reference}: ${park.name} <br> ${currentActivation.activator} on ${currentActivation.frequency} kHz (${currentActivation.mode})${currentActivation.comments ? ` <br> ${currentActivation.comments}` : ''}`
            : `${reference}: ${park.name} (${parkActivationCount} activations)`;
        results.push({
            park,
            state: {
                markerClassName: currentActivation ? 'pulse-marker' : 'park-marker',
                useDivIcon: false,
                currentActivation,
                tooltipText,
                circleOpts: {
                    radius: currentActivation ? 7 : 6,
                    fillColor,
                    color: '#000',
                    weight: 1,
                    fillOpacity: 0.85
                }
            }
        });
    }
    self.postMessage(results);
};
