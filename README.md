# OneWord :clipboard:
A dynamic node.js bulletin board that anyone on the WWW can post one word for others to see within seconds, creating pages for all to see.
<p align="center">
  <img src="https://github.com/ayirac/OneWord/blob/master/quick.gif">
</p>

# Features :pushpin:
- Post on and access OneWord with any device that can access the web.
- Navigation links for random pages, the current page, about page, and an contact page
  - About - Gives information about the site & shows the current parameters assigned for cooldowns/word limits per page
  - Contact - Form for requesting information, sends the data to a mssql table
- Dynamnically loading html in which updates are availble within seconds of being detected
- Dynamnic CSS that fits the UI to whatever resolution the user prefers
- Page selector, allowing you to look back at previous pages that have been completed historically
- Cooldown parameter that limits a user postings whenever they are on cooldown
- Word limit per page, once a certain amount of words has been added to a page a new page is created and the previous is archived
- Banned IP list, for disallowing certain IPs to make posts.
- Google recaptcha to discourage spam
- PUG used as the html template engine for inserting data into html
- mssql used for database for storing the pages, words, and IPs associated with each posting
- Various security measures are implemented such as stripping of tags and sql string escaping
