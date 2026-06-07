ymaps.ready(function () {
    const mapEl = document.getElementById('map-data');
    if (!mapEl) return;

    const coords = mapEl.dataset.coords.split(',').map(Number);
    const address = mapEl.dataset.address;

    var myMap = new ymaps.Map("map", {
        center: coords,
        zoom: 16
    });

    var myPlacemark = new ymaps.Placemark(coords, {
        hintContent: 'ВентРесурс',
        balloonContent: address
    });

    myMap.geoObjects.add(myPlacemark);
});